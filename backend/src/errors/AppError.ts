class AppError {
  public readonly message: string;

  public readonly statusCode: number;

  public readonly level: string;

  // Linhares: detalhes extras enviados ao frontend junto com o codigo do erro
  public readonly data?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode = 400,
    level = "warn",
    data?: Record<string, unknown>
  ) {
    this.message = message;
    this.statusCode = statusCode;
    this.level = level;
    this.data = data;
  }
}

export default AppError;
