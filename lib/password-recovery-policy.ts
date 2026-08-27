export function isPasswordRecoveryEnabled(
  value = process.env.TALON_PASSWORD_RECOVERY_ENABLED
): boolean {
  return value?.trim().toLowerCase() === "true"
}
