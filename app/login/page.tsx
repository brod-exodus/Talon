import { LoginForm } from "@/components/login-form"
import { isSelfServiceSignupEnabled } from "@/lib/registration-policy"

export const dynamic = "force-dynamic"

export default function LoginPage() {
  return <LoginForm allowSelfServiceSignup={isSelfServiceSignupEnabled()} />
}
