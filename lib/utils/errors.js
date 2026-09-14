export function publicError(
  error
) {
  console.error("[SERVER ERROR]", { code: error?.code, status: error?.status, message: error?.message });

  return {
    ok: false,
    error:
      "Terjadi kesalahan pada server.",
  };
}