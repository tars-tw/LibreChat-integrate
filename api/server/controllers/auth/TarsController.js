const { logger } = require('@librechat/data-schemas');
const { registerTars, resetTarsPassword } = require('@librechat/api');

/**
 * Thin pass-through to pwc_tars registration (`POST /api/auth/register`). pwc_tars owns
 * user accounts; the linked LibreChat shadow user is provisioned later, on first login.
 * Upstream status and message are forwarded so the client mirrors pwc_tars behavior.
 */
const tarsRegisterController = async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ message: 'Username, email, and password are required' });
  }

  try {
    const result = await registerTars(username, email, password);
    if (result.status >= 400) {
      return res.status(result.status).json({ message: result.message });
    }
    return res.status(result.status).json({ message: result.message, user: result.user });
  } catch (err) {
    logger.error('[tarsRegisterController]', err);
    return res.status(500).json({ message: 'Registration failed, please try again' });
  }
};

/**
 * Thin pass-through to pwc_tars password reset (`POST /api/auth/forget_password`).
 * pwc_tars verifies the username/email match and sets the new password directly.
 */
const tarsForgotPasswordController = async (req, res) => {
  const { username, user_email: userEmail, new_password: newPassword } = req.body;
  if (!username || !userEmail || !newPassword) {
    return res.status(400).json({ message: 'Username, user_email, and new_password are required' });
  }

  try {
    const result = await resetTarsPassword(username, userEmail, newPassword);
    return res.status(result.status).json({ message: result.message });
  } catch (err) {
    logger.error('[tarsForgotPasswordController]', err);
    return res.status(500).json({ message: 'Password update failed' });
  }
};

module.exports = {
  tarsRegisterController,
  tarsForgotPasswordController,
};
