-- CreateTable
CREATE TABLE "ProductConfiguration" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProductConfiguration_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "Prompt" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ProductConfiguration_aiModelId_fkey" FOREIGN KEY ("aiModelId") REFERENCES "AiModel" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Prompt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AiModel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'GOOGLE_GEMINI',
    "name" TEXT NOT NULL,
    "modelKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "pricePerImage" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "GelatoTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productConfigurationId" TEXT NOT NULL,
    "gelatoTemplateId" TEXT NOT NULL,
    "templateName" TEXT,
    "placeholderMapping" JSONB,
    "placementMapping" JSONB,
    "supplier" TEXT NOT NULL DEFAULT 'GELATO',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GelatoTemplate_productConfigurationId_fkey" FOREIGN KEY ("productConfigurationId") REFERENCES "ProductConfiguration" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PendingOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "shopifyOrderNumber" TEXT,
    "shopifyLineItemId" TEXT,
    "productConfigurationId" TEXT,
    "customerEmail" TEXT,
    "approvedMockupUrl" TEXT,
    "printFileUrl" TEXT,
    "artworkAssetId" TEXT,
    "personalizationData" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "rejectionReason" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PendingOrder_productConfigurationId_fkey" FOREIGN KEY ("productConfigurationId") REFERENCES "ProductConfiguration" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GenerationLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productConfigurationId" TEXT,
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
    CONSTRAINT "GenerationLog_aiModelId_fkey" FOREIGN KEY ("aiModelId") REFERENCES "AiModel" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ProductConfiguration_shop_idx" ON "ProductConfiguration"("shop");

-- CreateIndex
CREATE INDEX "ProductConfiguration_status_idx" ON "ProductConfiguration"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ProductConfiguration_shop_shopifyProductId_key" ON "ProductConfiguration"("shop", "shopifyProductId");

-- CreateIndex
CREATE INDEX "Prompt_shop_idx" ON "Prompt"("shop");

-- CreateIndex
CREATE INDEX "Prompt_status_idx" ON "Prompt"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Prompt_shop_name_key" ON "Prompt"("shop", "name");

-- CreateIndex
CREATE INDEX "AiModel_shop_idx" ON "AiModel"("shop");

-- CreateIndex
CREATE INDEX "AiModel_enabled_idx" ON "AiModel"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "AiModel_shop_modelKey_key" ON "AiModel"("shop", "modelKey");

-- CreateIndex
CREATE INDEX "GelatoTemplate_shop_idx" ON "GelatoTemplate"("shop");

-- CreateIndex
CREATE INDEX "GelatoTemplate_productConfigurationId_idx" ON "GelatoTemplate"("productConfigurationId");

-- CreateIndex
CREATE UNIQUE INDEX "GelatoTemplate_shop_gelatoTemplateId_key" ON "GelatoTemplate"("shop", "gelatoTemplateId");

-- CreateIndex
CREATE INDEX "PendingOrder_shop_idx" ON "PendingOrder"("shop");

-- CreateIndex
CREATE INDEX "PendingOrder_status_idx" ON "PendingOrder"("status");

-- CreateIndex
CREATE INDEX "PendingOrder_productConfigurationId_idx" ON "PendingOrder"("productConfigurationId");

-- CreateIndex
CREATE UNIQUE INDEX "PendingOrder_shop_shopifyOrderId_key" ON "PendingOrder"("shop", "shopifyOrderId");

-- CreateIndex
CREATE INDEX "GenerationLog_shop_idx" ON "GenerationLog"("shop");

-- CreateIndex
CREATE INDEX "GenerationLog_status_idx" ON "GenerationLog"("status");

-- CreateIndex
CREATE INDEX "GenerationLog_createdAt_idx" ON "GenerationLog"("createdAt");

-- CreateIndex
CREATE INDEX "GenerationLog_productConfigurationId_idx" ON "GenerationLog"("productConfigurationId");

-- CreateIndex
CREATE INDEX "GenerationLog_aiModelId_idx" ON "GenerationLog"("aiModelId");
