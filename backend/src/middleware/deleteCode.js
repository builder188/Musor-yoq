import env from '../config/env.js';
import Settings from '../models/Settings.js';

export async function requireDeleteCode(req, res, next) {
  const code = req.body?.code ?? req.body?.confirmationCode ?? req.query?.code;
  const settings = await Settings.getSingleton().catch(() => null);
  const expected = settings?.deleteCode || env.CONFIRM_DELETE_CODE;
  if (String(code) !== String(expected)) {
    return res.status(403).json({ error: "Noto'g'ri tasdiqlash kodi." });
  }
  req.deleteCodeVerified = true;
  next();
}

export default { requireDeleteCode };
