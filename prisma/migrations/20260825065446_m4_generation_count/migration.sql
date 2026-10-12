-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Customization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productMappingId" TEXT,
    "shopifyProductId" TEXT NOT NULL,
    "shopifyVariantId" TEXT,
    "artworkUrl" TEXT NOT NULL,
    "artworkKey" TEXT,
    "previewUrl" TEXT,
    "previewKey" TEXT,
    "placement" JSONB,
    "generationCount" INTEGER NOT NULL DEFAULT 0,
    "personalizationText" JSONB,
    "gelatoProductId" TEXT,
    "gelatoProductUid" TEXT,
    "gelatoVariantId" TEXT,
    "gelatoTemplateId" TEXT,
    "gelatoPlaceholderName" TEXT,
    "gelatoPrintAreaName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COMPLETE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Customization_productMappingId_fkey" FOREIGN KEY ("productMappingId") REFERENCES "ProductMapping" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Customization" ("artworkKey", "artworkUrl", "createdAt", "gelatoPlaceholderName", "gelatoPrintAreaName", "gelatoProductId", "gelatoProductUid", "gelatoTemplateId", "gelatoVariantId", "id", "personalizationText", "placement", "previewKey", "previewUrl", "productMappingId", "shop", "shopifyProductId", "shopifyVariantId", "status", "updatedAt") SELECT "artworkKey", "artworkUrl", "createdAt", "gelatoPlaceholderName", "gelatoPrintAreaName", "gelatoProductId", "gelatoProductUid", "gelatoTemplateId", "gelatoVariantId", "id", "personalizationText", "placement", "previewKey", "previewUrl", "productMappingId", "shop", "shopifyProductId", "shopifyVariantId", "status", "updatedAt" FROM "Customization";
DROP TABLE "Customization";
ALTER TABLE "new_Customization" RENAME TO "Customization";
CREATE INDEX "Customization_shop_idx" ON "Customization"("shop");
CREATE INDEX "Customization_shop_shopifyProductId_idx" ON "Customization"("shop", "shopifyProductId");
CREATE INDEX "Customization_productMappingId_idx" ON "Customization"("productMappingId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
