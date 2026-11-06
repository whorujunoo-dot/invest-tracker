// 환경 변수는 한곳에서만 읽는다. 값이 없으면 어떤 설정이 빠졌는지 바로 알려 준다.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`환경 변수 ${name} 가 설정되지 않았습니다 (docs/SETUP.md 참고)`);
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export const env = {
  get databaseUrl() { return required("DATABASE_URL"); },

  get telegramToken() { return required("TELEGRAM_BOT_TOKEN"); },
  get telegramWebhookSecret() { return required("TELEGRAM_WEBHOOK_SECRET"); },
  get telegramOwnerId() { return Number(required("TELEGRAM_OWNER_ID")); },

  get r2AccountId() { return required("R2_ACCOUNT_ID"); },
  get r2AccessKeyId() { return required("R2_ACCESS_KEY_ID"); },
  get r2SecretAccessKey() { return required("R2_SECRET_ACCESS_KEY"); },
  get r2Bucket() { return required("R2_BUCKET"); },

  get anthropicApiKey() { return required("ANTHROPIC_API_KEY"); },
  get claudeModel() { return optional("CLAUDE_MODEL", "claude-opus-5-5"); },

  get openaiApiKey() { return required("OPENAI_API_KEY"); },
  get transcribeModel() { return optional("TRANSCRIBE_MODEL", "gpt-4o-transcribe"); },

  get appPassword() { return required("APP_PASSWORD"); },
  get sessionSecret() { return required("SESSION_SECRET"); },
  get cronSecret() { return required("CRON_SECRET"); },

  get timeZone() { return optional("APP_TIME_ZONE", "Asia/Seoul"); },
};
