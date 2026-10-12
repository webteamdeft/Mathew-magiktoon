-- DropIndex
DROP INDEX "AiModel_enabled_idx";

-- DropIndex
DROP INDEX "GelatoTemplate_shop_gelatoTemplateId_key";

-- DropIndex
DROP INDEX "GenerationLog_status_idx";

-- DropIndex
DROP INDEX "PendingOrder_status_idx";

-- DropIndex
DROP INDEX "ProductConfiguration_status_idx";

-- DropIndex
DROP INDEX "Prompt_status_idx";

-- CreateIndex
CREATE INDEX "AiModel_shop_enabled_idx" ON "AiModel"("shop", "enabled");

-- CreateIndex
CREATE INDEX "GelatoTemplate_shop_gelatoTemplateId_idx" ON "GelatoTemplate"("shop", "gelatoTemplateId");

-- CreateIndex
CREATE INDEX "GelatoTemplate_shop_enabled_idx" ON "GelatoTemplate"("shop", "enabled");

-- CreateIndex
CREATE INDEX "GenerationLog_shop_status_idx" ON "GenerationLog"("shop", "status");

-- CreateIndex
CREATE INDEX "PendingOrder_shop_status_idx" ON "PendingOrder"("shop", "status");

-- CreateIndex
CREATE INDEX "ProductConfiguration_shop_status_idx" ON "ProductConfiguration"("shop", "status");

-- CreateIndex
CREATE INDEX "ProductConfiguration_promptId_idx" ON "ProductConfiguration"("promptId");

-- CreateIndex
CREATE INDEX "ProductConfiguration_aiModelId_idx" ON "ProductConfiguration"("aiModelId");

-- CreateIndex
CREATE INDEX "Prompt_shop_status_idx" ON "Prompt"("shop", "status");

-- CreateIndex
CREATE INDEX "Session_shop_idx" ON "Session"("shop");
