import { ResetPasswordForm } from "@/components/reset-password-form"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string }>
}) {
  const params = await searchParams
  return <ResetPasswordForm tokenHash={params.token_hash ?? ""} validType={params.type === "recovery"} />
}
