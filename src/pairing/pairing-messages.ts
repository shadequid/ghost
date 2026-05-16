export function buildPairingReply(params: {
  idLine: string;
  code: string;
}): string {
  // Plaintext — delivered with no parse_mode. Don't use Markdown fences here:
  // usernames and other passthrough values may contain metachars that would
  // break parsing and suppress the whole reply.
  return [
    "Ghost: access not configured.",
    "",
    params.idLine,
    `Pairing code: ${params.code}`,
    "",
    "Ask the bot owner to approve from the Ghost dashboard.",
  ].join("\n");
}
