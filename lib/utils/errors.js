export function publicError(
  error
) {
  console.error(
    "[SERVER ERROR]",
    error
  );

  return {
    ok: false,
    error:
      "Terjadi kesalahan pada server.",
  };
}