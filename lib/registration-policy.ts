export function isSelfServiceSignupEnabled(
  value = process.env.TALON_SELF_SERVICE_SIGNUP_ENABLED
): boolean {
  return value?.trim().toLowerCase() === "true"
}
