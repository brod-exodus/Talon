import { LoginForm } from "@/components/login-form"
import { isSelfServiceSignupEnabled } from "@/lib/registration-policy"
import { isPasswordRecoveryEnabled } from "@/lib/password-recovery-policy"

export const dynamic = "force-dynamic"

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const workspaceDeleted = params.workspaceDeleted === "1"
  const cleanupQueued = params.profilePhotoCleanup === "queued"
  const initialNotice = workspaceDeleted
    ? cleanupQueued
      ? "Workspace data was deleted. Profile-photo cleanup is queued and will retry automatically."
      : "Workspace data was permanently deleted."
    : ""

  return (
    <LoginForm
      allowSelfServiceSignup={isSelfServiceSignupEnabled()}
      allowPasswordRecovery={isPasswordRecoveryEnabled()}
      initialNotice={initialNotice}
    />
  )
}
