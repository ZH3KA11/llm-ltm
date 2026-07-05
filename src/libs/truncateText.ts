export const CHARACTER_TEXT_LIMIT = 500;

export function truncateText(
  value: unknown,
  maxLength = CHARACTER_TEXT_LIMIT,
): string {
  const characters = Array.from(String(value ?? ""));

  if (characters.length <= maxLength) {
    return characters.join("");
  }

  return `${characters.slice(0, maxLength - 1).join("").trimEnd()}…`;
}
