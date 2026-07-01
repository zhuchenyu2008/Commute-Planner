export function selectTemplateEmailRecipient(
  settings: Array<{ emailRecipient: string | null }>
): string | null {
  for (const setting of settings) {
    const recipient = setting.emailRecipient?.trim();

    if (recipient) {
      return recipient;
    }
  }

  return null;
}
