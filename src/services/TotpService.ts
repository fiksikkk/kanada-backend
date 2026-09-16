import { generateSecret, generateURI, verify } from "otplib";
import QRCode from "qrcode";

const ISSUER = "Kanada";
// Допуск на рассинхрон часов: ±30с (один шаг TOTP) в обе стороны, чтобы
// не ловить ложные отказы на слегка разъехавшихся часах телефона.
const EPOCH_TOLERANCE_SECONDS = 30;

export function generateTotpSecret(): string {
  return generateSecret();
}

export function buildOtpauthUri(username: string, secret: string): string {
  return generateURI({ issuer: ISSUER, label: username, secret });
}

export async function buildQrCodeDataUrl(otpauthUri: string): Promise<string> {
  return QRCode.toDataURL(otpauthUri);
}

export async function verifyTotpToken(
  token: string,
  secret: string,
): Promise<boolean> {
  try {
    const result = await verify({
      secret,
      token,
      epochTolerance: EPOCH_TOLERANCE_SECONDS,
    });
    return result.valid;
  } catch {
    return false;
  }
}
