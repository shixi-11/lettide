/** Register account-manager routes against the shared encrypted Store. */
export function registerAccountManagement(app, store) {
  app.put('/api/accounts/order', async (req, res) => {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) {
      return res.status(400).json({error: 'A complete, duplicate-free account id list is required'});
    }
    const result = await store.mutate(state => {
      const current = state.accounts.map(account => account.id);
      if (ids.length !== current.length || current.some(id => !ids.includes(id))) return false;
      const byId = new Map(state.accounts.map(account => [account.id, account]));
      state.accounts = ids.map(id => byId.get(id));
      return true;
    });
    if (!result) return res.status(409).json({error: 'Accounts changed while saving order; refresh and try again'});
    return res.json({ok: true});
  });
}
