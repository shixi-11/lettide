# 草稿删除与恢复契约

本轮问题：本机草稿仅有保存/编辑接口，列表和编辑窗口均无删除/清空入口。目标是让用户整理草稿，同时不丢发送回执、不误发、不越过确认范围。

表示：在原draft记录增加可选deletedAt，保留正文、附件及status/provider receipt。GET /api/drafts 默认只返回活跃草稿，includeDeleted=true用于UI恢复视图；旧记录不需迁移。DELETE /api/drafts/:id 软删；POST /api/drafts/:id/restore 恢复。PUT及发送claim拒绝deletedAt记录。发送中不能删除；outcome_unknown删除后仍保留未知状态，恢复不会允许重新发送。

批量：POST /api/drafts/clear 必须传已确认ids，可带有效非空accountId；同一事务取交集并跳过sending。确认后新建草稿、其他邮箱及未选中的草稿保留。未指定ids不会退化为清空全集。

非目标：不永久删除真实草稿、不自动重发、不清除sendResults；不重写邮箱服务商草稿同步。服务商草稿继续走既有邮件移动到Trash路径。本机单用户下单封沿用全局draft ID，与现有编辑/发送lookup一致；批量强校验当前账号范围。

验证：新增删除/清空/恢复/发送竞态回归先在旧代码失败，再在修复后通过；虚构UI检查列表/右键/Composer/清空/恢复、账号隔离、错误重试、未知结果、键盘和中英文。实际安装只核对版本及真实草稿保留，不操作用户草稿。
