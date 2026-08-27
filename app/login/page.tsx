import { LoginForm } from "@/components/login-form"
import { isSelfServiceSignupEnabled } from "@/lib/registration-policy"
import { isPasswordRecoveryEnabled } from "@/lib/password-recovery-policy"

export const dynamic = "force-dynamic"

export default function LoginPage() {
  return (
    <LoginForm
      allowSelfServiceSignup={isSelfServiceSignupEnabled()}
      allowPasswordRecovery={isPasswordRecoveryEnabled()}
    />
  )
}
