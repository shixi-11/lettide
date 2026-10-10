export function supportsArchive(account, folders = []) {
 return !!account && (account.provider === 'gmail' || folders.some(f => f.accountId === account.id && f.role === 'archive') || (account.folders || []).some(f => f.role === 'archive'));
}
