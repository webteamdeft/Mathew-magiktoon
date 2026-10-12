-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_GenerationLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productConfigurationId" TEXT,
    "productMappingId" TEXT,
    "aiModelId" TEXT,
    "shopifyOrderId" TEXT,
    "generationType" TEXT NOT NULL DEFAULT 'INITIAL',
    "status" TEXT NOT NULL,
    "durationMs" INTEGER,
    "estimatedCost" REAL,
    "inputAssetId" TEXT,
    "outputAssetId" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GenerationLog_productConfigurationId_fkey" FOREIGN KEY ("productConfigurationId") REFERENCES "ProductConfiguration" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "GenerationLog_productMappingId_fkey" FOREIGN KEY ("productMappingId") REFERENCES "ProductMapping" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "GenerationLog_aiModelId_fkey" FOREIGN KEY ("aiModelId") REFERENCES "AiModel" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_GenerationLog" ("aiModelId", "createdAt", "durationMs", "errorMessage", "estimatedCost", "generationType", "id", "inputAssetId", "outputAssetId", "productConfigurationId", "shop", "shopifyOrderId", "status") SELECT "aiModelId", "createdAt", "durationMs", "errorMessage", "estimatedCost", "generationType", "id", "inputAssetId", "outputAssetId", "productConfigurationId", "shop", "shopifyOrderId", "status" FROM "GenerationLog";
DROP TABLE "GenerationLog";
ALTER TABLE "new_GenerationLog" RENAME TO "GenerationLog";
CREATE INDEX "GenerationLog_shop_idx" ON "GenerationLog"("shop");
CREATE INDEX "GenerationLog_shop_status_idx" ON "GenerationLog"("shop", "status");
CREATE INDEX "GenerationLog_createdAt_idx" ON "GenerationLog"("createdAt");
CREATE INDEX "GenerationLog_productConfigurationId_idx" ON "GenerationLog"("productConfigurationId");
CREATE INDEX "GenerationLog_productMappingId_idx" ON "GenerationLog"("productMappingId");
CREATE INDEX "GenerationLog_aiModelId_idx" ON "GenerationLog"("aiModelId");
CREATE TABLE "new_ProductMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "shopifyProductNumericId" TEXT NOT NULL,
    "shopifyVariantId" TEXT,
    "shopifyVariantTitle" TEXT,
    "shopifyProductTitle" TEXT NOT NULL,
    "shopifyProductHandle" TEXT,
    "shopifyProductImageUrl" TEXT,
    "gelatoProductId" TEXT NOT NULL,
    "gelatoProductName" TEXT,
    "gelatoProductUid" TEXT,
    "gelatoVariantId" TEXT,
    "gelatoVariantName" TEXT,
    "gelatoTemplateId" TEXT NOT NULL,
    "gelatoTemplateName" TEXT,
    "gelatoPlaceholderName" TEXT NOT NULL DEFAULT 'ImageFront',
    "gelatoPrintAreaName" TEXT NOT NULL DEFAULT 'front',
    "gelatoPlaceholderWidth" REAL,
    "gelatoPlaceholderHeight" REAL,
    "printAreaX" REAL NOT NULL DEFAULT 0.3,
    "printAreaY" REAL NOT NULL DEFAULT 0.3,
    "printAreaSize" REAL NOT NULL DEFAULT 0.42,
    "gelatoTextPlaceholders" JSONB,
    "gelatoImageCount" INTEGER NOT NULL DEFAULT 1,
    "layers" JSONB,
    "gelatoPreviewUrl" TEXT,
    "gelatoRawTemplate" JSONB,
    "designLabel" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "designRef" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "promptId" TEXT,
    "aiModelId" TEXT,
    "outputResolution" TEXT NOT NULL DEFAULT '2K',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProductMapping_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "Prompt" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ProductMapping_aiModelId_fkey" FOREIGN KEY ("aiModelId") REFERENCES "AiModel" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ProductMapping" ("createdAt", "designLabel", "designRef", "gelatoImageCount", "gelatoPlaceholderHeight", "gelatoPlaceholderName", "gelatoPlaceholderWidth", "gelatoPreviewUrl", "gelatoPrintAreaName", "gelatoProductId", "gelatoProductName", "gelatoProductUid", "gelatoRawTemplate", "gelatoTemplateId", "gelatoTemplateName", "gelatoTextPlaceholders", "gelatoVariantId", "gelatoVariantName", "id", "layers", "printAreaSize", "printAreaX", "printAreaY", "shop", "shopifyProductHandle", "shopifyProductId", "shopifyProductImageUrl", "shopifyProductNumericId", "shopifyProductTitle", "shopifyVariantId", "shopifyVariantTitle", "sortOrder", "status", "updatedAt") SELECT "createdAt", "designLabel", "designRef", "gelatoImageCount", "gelatoPlaceholderHeight", "gelatoPlaceholderName", "gelatoPlaceholderWidth", "gelatoPreviewUrl", "gelatoPrintAreaName", "gelatoProductId", "gelatoProductName", "gelatoProductUid", "gelatoRawTemplate", "gelatoTemplateId", "gelatoTemplateName", "gelatoTextPlaceholders", "gelatoVariantId", "gelatoVariantName", "id", "layers", "printAreaSize", "printAreaX", "printAreaY", "shop", "shopifyProductHandle", "shopifyProductId", "shopifyProductImageUrl", "shopifyProductNumericId", "shopifyProductTitle", "shopifyVariantId", "shopifyVariantTitle", "sortOrder", "status", "updatedAt" FROM "ProductMapping";
DROP TABLE "ProductMapping";
ALTER TABLE "new_ProductMapping" RENAME TO "ProductMapping";
CREATE INDEX "ProductMapping_shop_idx" ON "ProductMapping"("shop");
CREATE INDEX "ProductMapping_shop_status_idx" ON "ProductMapping"("shop", "status");
CREATE INDEX "ProductMapping_shop_shopifyProductNumericId_idx" ON "ProductMapping"("shop", "shopifyProductNumericId");
CREATE INDEX "ProductMapping_shop_shopifyProductNumericId_status_idx" ON "ProductMapping"("shop", "shopifyProductNumericId", "status");
CREATE UNIQUE INDEX "ProductMapping_shop_shopifyProductId_designRef_key" ON "ProductMapping"("shop", "shopifyProductId", "designRef");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
