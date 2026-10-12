-- AlterTable
ALTER TABLE "PendingOrder" ADD COLUMN "gelatoProductId" TEXT;
ALTER TABLE "PendingOrder" ADD COLUMN "gelatoTemplateId" TEXT;
ALTER TABLE "PendingOrder" ADD COLUMN "gelatoVariantId" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_GelatoTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productConfigurationId" TEXT NOT NULL,
    "gelatoTemplateId" TEXT NOT NULL,
    "gelatoTemplateVariantId" TEXT,
    "gelatoProductId" TEXT,
    "gelatoVariantId" TEXT,
    "templateName" TEXT,
    "templatePreviewUrl" TEXT,
    "placeholderMapping" JSONB,
    "placementMapping" JSONB,
    "variants" JSONB,
    "rawTemplateResponse" JSONB,
    "rawProductResponse" JSONB,
    "supplier" TEXT NOT NULL DEFAULT 'GELATO',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GelatoTemplate_productConfigurationId_fkey" FOREIGN KEY ("productConfigurationId") REFERENCES "ProductConfiguration" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_GelatoTemplate" ("createdAt", "enabled", "gelatoTemplateId", "id", "placeholderMapping", "placementMapping", "productConfigurationId", "shop", "supplier", "templateName", "updatedAt") SELECT "createdAt", "enabled", "gelatoTemplateId", "id", "placeholderMapping", "placementMapping", "productConfigurationId", "shop", "supplier", "templateName", "updatedAt" FROM "GelatoTemplate";
DROP TABLE "GelatoTemplate";
ALTER TABLE "new_GelatoTemplate" RENAME TO "GelatoTemplate";
CREATE INDEX "GelatoTemplate_shop_idx" ON "GelatoTemplate"("shop");
CREATE INDEX "GelatoTemplate_shop_gelatoTemplateId_idx" ON "GelatoTemplate"("shop", "gelatoTemplateId");
CREATE INDEX "GelatoTemplate_productConfigurationId_idx" ON "GelatoTemplate"("productConfigurationId");
CREATE INDEX "GelatoTemplate_shop_enabled_idx" ON "GelatoTemplate"("shop", "enabled");
CREATE TABLE "new_ProductConfiguration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "productHandle" TEXT,
    "themeName" TEXT NOT NULL,
    "promptId" TEXT,
    "aiModelId" TEXT,
    "outputResolution" TEXT NOT NULL DEFAULT '2K',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "backgroundImageUrl" TEXT,
    "placementAreas" JSONB,
    "editableTextEnabled" BOOLEAN NOT NULL DEFAULT false,
    "fixedTextConfiguration" JSONB,
    "supplierSku" TEXT,
    "printFileRequirements" TEXT,
    "mockupTemplate" TEXT,
    "pricingRules" JSONB,
    "shippingRules" JSONB,
    "gelatoStoreId" TEXT,
    "gelatoTemplateId" TEXT,
    "gelatoProductId" TEXT,
    "gelatoVariantId" TEXT,
    "gelatoTemplateVariantId" TEXT,
    "gelatoPlaceholderName" TEXT,
    "gelatoPlacementArea" TEXT,
    "gelatoTemplatePreviewUrl" TEXT,
    "gelatoProductStatus" TEXT,
    "gelatoRawTemplate" JSONB,
    "gelatoRawProduct" JSONB,
    "storefrontEnabled" BOOLEAN NOT NULL DEFAULT false,
    "allowProductSelection" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProductConfiguration_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "Prompt" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ProductConfiguration_aiModelId_fkey" FOREIGN KEY ("aiModelId") REFERENCES "AiModel" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ProductConfiguration" ("aiModelId", "backgroundImageUrl", "createdAt", "editableTextEnabled", "fixedTextConfiguration", "id", "mockupTemplate", "outputResolution", "placementAreas", "pricingRules", "printFileRequirements", "productHandle", "productTitle", "promptId", "shippingRules", "shop", "shopifyProductId", "status", "supplierSku", "themeName", "updatedAt") SELECT "aiModelId", "backgroundImageUrl", "createdAt", "editableTextEnabled", "fixedTextConfiguration", "id", "mockupTemplate", "outputResolution", "placementAreas", "pricingRules", "printFileRequirements", "productHandle", "productTitle", "promptId", "shippingRules", "shop", "shopifyProductId", "status", "supplierSku", "themeName", "updatedAt" FROM "ProductConfiguration";
DROP TABLE "ProductConfiguration";
ALTER TABLE "new_ProductConfiguration" RENAME TO "ProductConfiguration";
CREATE INDEX "ProductConfiguration_shop_idx" ON "ProductConfiguration"("shop");
CREATE INDEX "ProductConfiguration_shop_status_idx" ON "ProductConfiguration"("shop", "status");
CREATE INDEX "ProductConfiguration_shop_storefrontEnabled_idx" ON "ProductConfiguration"("shop", "storefrontEnabled");
CREATE INDEX "ProductConfiguration_promptId_idx" ON "ProductConfiguration"("promptId");
CREATE INDEX "ProductConfiguration_aiModelId_idx" ON "ProductConfiguration"("aiModelId");
CREATE INDEX "ProductConfiguration_gelatoTemplateId_idx" ON "ProductConfiguration"("gelatoTemplateId");
CREATE UNIQUE INDEX "ProductConfiguration_shop_shopifyProductId_key" ON "ProductConfiguration"("shop", "shopifyProductId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
