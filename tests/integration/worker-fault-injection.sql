\set ON_ERROR_STOP on
\echo '[fault-injection] starting durable worker recovery scenarios'

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(condition BOOLEAN, failure_message TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'fault-injection assertion failed: %', failure_message;
  END IF;
END;
$$;

DO $$
DECLARE
  team_a CONSTANT UUID := '10000000-0000-4000-8000-000000000001';
  team_b CONSTANT UUID := '20000000-0000-4000-8000-000000000002';
  discovery_job CONSTANT UUID := '30000000-0000-4000-8000-000000000003';
  hydration_job CONSTANT UUID := '40000000-0000-4000-8000-000000000004';
  canceled_job CONSTANT UUID := '50000000-0000-4000-8000-000000000005';
  cooldown_job CONSTANT UUID := '60000000-0000-4000-8000-000000000006';
  other_team_job CONSTANT UUID := '70000000-0000-4000-8000-000000000007';
  claimed public.scrape_jobs%ROWTYPE;
  transition RECORD;
  profile_batch JSONB := jsonb_build_array(jsonb_build_object(
    'username', 'fault-injection-user',
    'name', 'Fault Injection User',
    'avatar', 'https://avatars.githubusercontent.com/u/1?v=4',
    'contributions', 7,
    'email', 'public@example.com'
  ));
BEGIN
  INSERT INTO public.teams (id, slug, name)
  VALUES
    (team_a, 'fault-injection-a', 'Fault Injection A'),
    (team_b, 'fault-injection-b', 'Fault Injection B');

  RAISE NOTICE '[fault-injection] scenario 1: checkpoint survives stale lease handoff';
  INSERT INTO public.scrapes (id, team_id, type, target, status)
  VALUES ('fault-discovery', team_a, 'repository', 'public/example', 'active');
  INSERT INTO public.scrape_jobs (id, scrape_id, team_id, type, target, state)
  VALUES (discovery_job, 'fault-discovery', team_a, 'repository', 'public/example', '{"phase":"discover","page":1}');

  SELECT * INTO claimed FROM public.claim_scrape_job('worker-old', team_a);
  PERFORM pg_temp.assert_true(claimed.id = discovery_job, 'the intended discovery job was not claimed');
  SELECT * INTO transition FROM public.checkpoint_scrape_job(
    discovery_job, 'worker-old', '{"phase":"discover","page":2}', 25, 1, 4, NULL
  );
  PERFORM pg_temp.assert_true(transition.applied, 'the active worker checkpoint was rejected');

  UPDATE public.scrape_jobs SET locked_at = NOW() - INTERVAL '10 minutes' WHERE id = discovery_job;
  SELECT * INTO transition FROM public.recover_stale_scrape_job(
    discovery_job, 'worker-old', NOW() - INTERVAL '5 minutes', 'queued', 'injected interruption'
  );
  PERFORM pg_temp.assert_true(transition.applied AND transition.result_status = 'queued', 'stale job did not requeue');

  SELECT * INTO claimed FROM public.claim_scrape_job('worker-new', team_a);
  PERFORM pg_temp.assert_true(claimed.id = discovery_job, 'replacement worker did not reclaim the job');
  SELECT * INTO transition FROM public.checkpoint_scrape_job(
    discovery_job, 'worker-old', '{"phase":"discover","page":99}', 90, 9, 10, NULL
  );
  PERFORM pg_temp.assert_true(NOT transition.applied, 'the stale worker overwrote the replacement lease');
  SELECT * INTO transition FROM public.checkpoint_scrape_job(
    discovery_job, 'worker-new', '{"phase":"discover","page":3}', 50, 2, 4, NULL
  );
  PERFORM pg_temp.assert_true(transition.applied, 'replacement worker could not resume the checkpoint');
  PERFORM pg_temp.assert_true(
    (SELECT state ->> 'page' = '3' AND attempts = 2 FROM public.scrape_jobs WHERE id = discovery_job),
    'persisted cursor or attempt count did not reconcile after handoff'
  );
  PERFORM public.cancel_scrape_job(discovery_job, team_a, 'fixture complete');

  RAISE NOTICE '[fault-injection] scenario 2: committed hydration replays idempotently';
  INSERT INTO public.scrapes (id, team_id, type, target, status)
  VALUES ('fault-hydration', team_a, 'repository', 'public/hydration', 'active');
  INSERT INTO public.scrape_jobs (id, scrape_id, team_id, type, target, state)
  VALUES (hydration_job, 'fault-hydration', team_a, 'repository', 'public/hydration', '{"phase":"hydrate"}');
  INSERT INTO public.scrape_job_contributions (job_id, team_id, github_login, contributions)
  VALUES (hydration_job, team_a, 'fault-injection-user', 7);

  SELECT * INTO claimed FROM public.claim_scrape_job('hydrate-old', team_a);
  SELECT * INTO transition FROM public.checkpoint_scrape_hydration_batch(hydration_job, 'hydrate-old', profile_batch);
  PERFORM pg_temp.assert_true(transition.applied AND transition.processed_count = 1, 'first hydration checkpoint failed');

  UPDATE public.scrape_jobs SET locked_at = NOW() - INTERVAL '10 minutes' WHERE id = hydration_job;
  PERFORM public.recover_stale_scrape_job(
    hydration_job, 'hydrate-old', NOW() - INTERVAL '5 minutes', 'queued', 'injected post-checkpoint interruption'
  );
  SELECT * INTO claimed FROM public.claim_scrape_job('hydrate-new', team_a);
  SELECT * INTO transition FROM public.complete_scrape_job_verified(hydration_job, 'hydrate-old');
  PERFORM pg_temp.assert_true(
    NOT transition.applied AND transition.result_status = 'running',
    'stale worker completed after hydration lease handoff'
  );
  SELECT * INTO transition FROM public.checkpoint_scrape_hydration_batch(hydration_job, 'hydrate-new', profile_batch);
  PERFORM pg_temp.assert_true(transition.applied AND transition.processed_count = 1, 'replayed hydration checkpoint failed');
  PERFORM pg_temp.assert_true(
    (SELECT COUNT(*) = 1 FROM public.contributors WHERE team_id = team_a AND github_username = 'fault-injection-user'),
    'hydration replay duplicated the contributor'
  );
  PERFORM pg_temp.assert_true(
    (SELECT COUNT(*) = 1 FROM public.scrape_contributors WHERE team_id = team_a AND scrape_id = 'fault-hydration'),
    'hydration replay duplicated the scrape link'
  );

  SELECT * INTO transition FROM public.complete_scrape_job_verified(hydration_job, 'hydrate-new');
  PERFORM pg_temp.assert_true(
    transition.applied AND transition.result_status = 'succeeded'
      AND transition.contributor_total = 1 AND transition.contact_info_count = 1,
    'database-authoritative completion did not reconcile terminal counts'
  );

  RAISE NOTICE '[fault-injection] scenario 3: cancellation beats a late checkpoint';
  INSERT INTO public.scrapes (id, team_id, type, target, status)
  VALUES ('fault-cancel', team_a, 'repository', 'public/cancel', 'active');
  INSERT INTO public.scrape_jobs (id, scrape_id, team_id, type, target, state)
  VALUES (canceled_job, 'fault-cancel', team_a, 'repository', 'public/cancel', '{"phase":"discover","page":1}');
  SELECT * INTO claimed FROM public.claim_scrape_job('cancel-old', team_a);
  PERFORM public.cancel_scrape_job(canceled_job, team_a, 'injected cancellation');
  SELECT * INTO transition FROM public.checkpoint_scrape_job(
    canceled_job, 'cancel-old', '{"phase":"discover","page":2}', 20, 1, 5, NULL
  );
  PERFORM pg_temp.assert_true(NOT transition.applied AND transition.result_status = 'canceled', 'late checkpoint overwrote cancellation');

  RAISE NOTICE '[fault-injection] scenario 4: GitHub cooldown is global and workspace claims stay scoped';
  INSERT INTO public.scrapes (id, team_id, type, target, status)
  VALUES
    ('fault-cooldown', team_a, 'repository', 'public/cooldown', 'active'),
    ('fault-other-team', team_b, 'repository', 'public/other-team', 'active');
  INSERT INTO public.scrape_jobs (id, scrape_id, team_id, type, target, state)
  VALUES
    (cooldown_job, 'fault-cooldown', team_a, 'repository', 'public/cooldown', '{"phase":"discover"}'),
    (other_team_job, 'fault-other-team', team_b, 'repository', 'public/other-team', '{"phase":"discover"}');

  SELECT * INTO claimed FROM public.claim_scrape_job('cooldown-worker', team_a);
  SELECT * INTO transition FROM public.fail_scrape_job_step_with_github_cooldown(
    cooldown_job, 'cooldown-worker', 'queued', NOW() + INTERVAL '1 hour',
    'injected GitHub rate limit', 3600000, NOW() + INTERVAL '1 hour', 'primary-rate-limit'
  );
  PERFORM pg_temp.assert_true(transition.applied, 'GitHub cooldown transition failed');

  SELECT * INTO claimed FROM public.claim_scrape_job('blocked-other-team', team_b);
  PERFORM pg_temp.assert_true(claimed.id IS NULL, 'global cooldown allowed another workspace to claim');
  PERFORM pg_temp.assert_true(
    (SELECT attempts = 0 FROM public.scrape_jobs WHERE id = other_team_job),
    'blocked claim consumed the other workspace retry budget'
  );

  UPDATE public.service_cooldowns SET blocked_until = NOW() - INTERVAL '1 second' WHERE service = 'github';
  SELECT * INTO claimed FROM public.claim_scrape_job('wrong-workspace', team_a);
  PERFORM pg_temp.assert_true(claimed.id IS NULL, 'team-scoped claim crossed into another workspace');
  SELECT * INTO claimed FROM public.claim_scrape_job('other-team-worker', team_b);
  PERFORM pg_temp.assert_true(claimed.id = other_team_job, 'eligible workspace could not claim after cooldown');

  RAISE NOTICE '[fault-injection] all durable worker recovery scenarios passed';
END;
$$;

ROLLBACK;

\echo '[fault-injection] completed; fixture transaction rolled back'
