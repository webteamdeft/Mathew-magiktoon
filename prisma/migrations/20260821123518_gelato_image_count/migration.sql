-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "gelatoPreviewUrl" TEXT,
    "gelatoRawTemplate" JSONB,
    "designLabel" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "designRef" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ProductMapping" ("createdAt", "designLabel", "designRef", "gelatoPlaceholderHeight", "gelatoPlaceholderName", "gelatoPlaceholderWidth", "gelatoPreviewUrl", "gelatoPrintAreaName", "gelatoProductId", "gelatoProductName", "gelatoProductUid", "gelatoRawTemplate", "gelatoTemplateId", "gelatoTemplateName", "gelatoTextPlaceholders", "gelatoVariantId", "gelatoVariantName", "id", "printAreaSize", "printAreaX", "printAreaY", "shop", "shopifyProductHandle", "shopifyProductId", "shopifyProductImageUrl", "shopifyProductNumericId", "shopifyProductTitle", "shopifyVariantId", "shopifyVariantTitle", "sortOrder", "status", "updatedAt") SELECT "createdAt", "designLabel", "designRef", "gelatoPlaceholderHeight", "gelatoPlaceholderName", "gelatoPlaceholderWidth", "gelatoPreviewUrl", "gelatoPrintAreaName", "gelatoProductId", "gelatoProductName", "gelatoProductUid", "gelatoRawTemplate", "gelatoTemplateId", "gelatoTemplateName", "gelatoTextPlaceholders", "gelatoVariantId", "gelatoVariantName", "id", "printAreaSize", "printAreaX", "printAreaY", "shop", "shopifyProductHandle", "shopifyProductId", "shopifyProductImageUrl", "shopifyProductNumericId", "shopifyProductTitle", "shopifyVariantId", "shopifyVariantTitle", "sortOrder", "status", "updatedAt" FROM "ProductMapping";
DROP TABLE "ProductMapping";
ALTER TABLE "new_ProductMapping" RENAME TO "ProductMapping";
CREATE INDEX "ProductMapping_shop_idx" ON "ProductMapping"("shop");
CREATE INDEX "ProductMapping_shop_status_idx" ON "ProductMapping"("shop", "status");
CREATE INDEX "ProductMapping_shop_shopifyProductNumericId_idx" ON "ProductMapping"("shop", "shopifyProductNumericId");
CREATE INDEX "ProductMapping_shop_shopifyProductNumericId_status_idx" ON "ProductMapping"("shop", "shopifyProductNumericId", "status");
CREATE UNIQUE INDEX "ProductMapping_shop_shopifyProductId_designRef_key" ON "ProductMapping"("shop", "shopifyProductId", "designRef");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
