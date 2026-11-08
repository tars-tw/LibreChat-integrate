const { isTarsConfigured, canUseTarsAdminPageNow } = require('@librechat/api');

/**
 * Gates a pwc_tars admin page's API on the same grant that shows the page: a
 * tars admin, a linked user whose role was given one of `keys` in 角色設定, or —
 * for 知識庫清單 — anyone on a knowledge base's management list.
 * Must run after `requireJwtAuth`.
 * @param {...string} keys LibreChat admin-menu keys (`ADMIN_MENU_TREE`), e.g. `kb.list`.
 */
const requireTarsMenuAccess =
  (...keys) =>
  async (req, res, next) => {
    if (!isTarsConfigured() || !(await canUseTarsAdminPageNow(req.user, keys))) {
      return res.status(403).json({ error: 'pwc_tars menu access required' });
    }
    next();
  };

module.exports = requireTarsMenuAccess;
