const { isTarsConfigured, canUseTarsAdminPage } = require('@librechat/api');

/**
 * Gates a pwc_tars admin page's API on the same grant that shows the page: a
 * tars admin, or a linked user whose role was given one of `keys` in 角色設定.
 * Must run after `requireJwtAuth`.
 * @param {...string} keys LibreChat admin-menu keys (`ADMIN_MENU_TREE`), e.g. `kb.list`.
 */
const requireTarsMenuAccess =
  (...keys) =>
  (req, res, next) => {
    if (!isTarsConfigured() || !canUseTarsAdminPage(req.user, keys)) {
      return res.status(403).json({ error: 'pwc_tars menu access required' });
    }
    next();
  };

module.exports = requireTarsMenuAccess;
