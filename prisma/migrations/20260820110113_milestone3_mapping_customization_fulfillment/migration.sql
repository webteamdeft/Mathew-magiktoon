-- CreateTable
CREATE TABLE "ProductMapping" (
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
    "gelatoVariantId" TEXT,
    "gelatoVariantName" TEXT,
    "gelatoTemplateId" TEXT NOT NULL,
    "gelatoTemplateName" TEXT,
    "gelatoPlaceholderName" TEXT NOT NULL DEFAULT 'ImageFront',
    "gelatoPrintAreaName" TEXT NOT NULL DEFAULT 'front',
    "gelatoPreviewUrl" TEXT,
    "gelatoRawTemplate" JSONB,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Customization" (
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
    "gelatoProductId" TEXT,
    "gelatoVariantId" TEXT,
    "gelatoTemplateId" TEXT,
    "gelatoPlaceholderName" TEXT,
    "gelatoPrintAreaName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COMPLETE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Customization_productMappingId_fkey" FOREIGN KEY ("productMappingId") REFERENCES "ProductMapping" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GelatoOrderItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "shopifyOrderName" TEXT,
    "shopifyLineItemId" TEXT NOT NULL,
    "customizationId" TEXT,
    "productMappingId" TEXT,
    "gelatoOrderId" TEXT,
    "gelatoOrderReferenceId" TEXT NOT NULL,
    "gelatoOrderStatus" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "artworkUrl" TEXT,
    "previewUrl" TEXT,
    "requestPayload" JSONB,
    "responsePayload" JSONB,
    "submittedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GelatoOrderItem_customizationId_fkey" FOREIGN KEY ("customizationId") REFERENCES "Customization" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "GelatoOrderItem_productMappingId_fkey" FOREIGN KEY ("productMappingId") REFERENCES "ProductMapping" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ProductMapping_shop_idx" ON "ProductMapping"("shop");

-- CreateIndex
CREATE INDEX "ProductMapping_shop_status_idx" ON "ProductMapping"("shop", "status");

-- CreateIndex
CREATE INDEX "ProductMapping_shop_shopifyProductNumericId_idx" ON "ProductMapping"("shop", "shopifyProductNumericId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductMapping_shop_shopifyProductId_key" ON "ProductMapping"("shop", "shopifyProductId");

-- CreateIndex
CREATE INDEX "Customization_shop_idx" ON "Customization"("shop");

-- CreateIndex
CREATE INDEX "Customization_shop_shopifyProductId_idx" ON "Customization"("shop", "shopifyProductId");

-- CreateIndex
CREATE INDEX "Customization_productMappingId_idx" ON "Customization"("productMappingId");

-- CreateIndex
CREATE INDEX "GelatoOrderItem_shop_idx" ON "GelatoOrderItem"("shop");

-- CreateIndex
CREATE INDEX "GelatoOrderItem_shop_status_idx" ON "GelatoOrderItem"("shop", "status");

-- CreateIndex
CREATE INDEX "GelatoOrderItem_shop_shopifyOrderId_idx" ON "GelatoOrderItem"("shop", "shopifyOrderId");

-- CreateIndex
CREATE INDEX "GelatoOrderItem_customizationId_idx" ON "GelatoOrderItem"("customizationId");

-- CreateIndex
CREATE UNIQUE INDEX "GelatoOrderItem_shop_shopifyOrderId_shopifyLineItemId_key" ON "GelatoOrderItem"("shop", "shopifyOrderId", "shopifyLineItemId");
