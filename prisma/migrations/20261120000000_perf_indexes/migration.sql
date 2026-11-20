-- Índices de rendimiento — auditoría 2026-11-20
-- Cubren orderBy(createdAt) en ReceiptPattern y los joins/búsquedas por actor
-- y entidad auditada en SettingAuditLog. No alteran datos ni relaciones.

CREATE INDEX "ReceiptPattern_tenantId_createdAt_idx"
  ON "ReceiptPattern"("tenantId", "createdAt");

CREATE INDEX "SettingAuditLog_tenantId_entity_entityId_createdAt_idx"
  ON "SettingAuditLog"("tenantId", "entity", "entityId", "createdAt");

CREATE INDEX "SettingAuditLog_actorId_idx"
  ON "SettingAuditLog"("actorId");
