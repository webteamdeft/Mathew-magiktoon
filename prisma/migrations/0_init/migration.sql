-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductConfiguration" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "shopifyVariantId" TEXT,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prompt" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Prompt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiModel" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'GOOGLE_GEMINI',
    "name" TEXT NOT NULL,
    "modelKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "pricePerImage" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GelatoTemplate" (
    "id" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GelatoTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopSetting" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderReviewEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingOrder" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "shopifyOrderNumber" TEXT,
    "shopifyLineItemId" TEXT,
    "productConfigurationId" TEXT,
    "gelatoTemplateId" TEXT,
    "gelatoProductId" TEXT,
    "gelatoVariantId" TEXT,
    "customerEmail" TEXT,
    "approvedMockupUrl" TEXT,
    "printFileUrl" TEXT,
    "artworkAssetId" TEXT,
    "personalizationData" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "rejectionReason" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationLog" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "productConfigurationId" TEXT,
    "productMappingId" TEXT,
    "aiModelId" TEXT,
    "shopifyOrderId" TEXT,
    "generationType" TEXT NOT NULL DEFAULT 'INITIAL',
    "status" TEXT NOT NULL,
    "durationMs" INTEGER,
    "estimatedCost" DOUBLE PRECISION,
    "modelKey" TEXT,
    "resolution" TEXT,
    "inputAssetId" TEXT,
    "outputAssetId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GenerationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductMapping" (
    "id" TEXT NOT NULL,
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
    "gelatoPlaceholderWidth" DOUBLE PRECISION,
    "gelatoPlaceholderHeight" DOUBLE PRECISION,
    "printAreaX" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "printAreaY" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "printAreaSize" DOUBLE PRECISION NOT NULL DEFAULT 0.42,
    "gelatoTextPlaceholders" JSONB,
    "gelatoImageCount" INTEGER NOT NULL DEFAULT 1,
    "layers" JSONB,
    "gelatoPreviewUrl" TEXT,
    "gelatoRawTemplate" JSONB,
    "designLabel" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "designRef" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "backgroundImageKey" TEXT,
    "backgroundImageName" TEXT,
    "backgroundPlaceholderName" TEXT,
    "supplierSku" TEXT,
    "printFileRequirements" TEXT,
    "mockupTemplate" TEXT,
    "pricingRules" JSONB,
    "shippingRules" JSONB,
    "promptId" TEXT,
    "aiModelId" TEXT,
    "outputResolution" TEXT NOT NULL DEFAULT '2K',
    "aspectRatio" TEXT,
    "temperature" DOUBLE PRECISION,
    "seed" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customization" (
    "id" TEXT NOT NULL,
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
    "configSnapshot" JSONB,
    "personalizationText" JSONB,
    "gelatoProductId" TEXT,
    "gelatoProductUid" TEXT,
    "gelatoVariantId" TEXT,
    "gelatoTemplateId" TEXT,
    "gelatoPlaceholderName" TEXT,
    "gelatoPrintAreaName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COMPLETE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GelatoOrderItem" (
    "id" TEXT NOT NULL,
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
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "requestPayload" JSONB,
    "responsePayload" JSONB,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GelatoOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Session_shop_idx" ON "Session"("shop");

-- CreateIndex
CREATE INDEX "ProductConfiguration_shop_idx" ON "ProductConfiguration"("shop");

-- CreateIndex
CREATE INDEX "ProductConfiguration_shop_status_idx" ON "ProductConfiguration"("shop", "status");

-- CreateIndex
CREATE INDEX "ProductConfiguration_shop_storefrontEnabled_idx" ON "ProductConfiguration"("shop", "storefrontEnabled");

-- CreateIndex
CREATE INDEX "ProductConfiguration_promptId_idx" ON "ProductConfiguration"("promptId");

-- CreateIndex
CREATE INDEX "ProductConfiguration_aiModelId_idx" ON "ProductConfiguration"("aiModelId");

-- CreateIndex
CREATE INDEX "ProductConfiguration_gelatoTemplateId_idx" ON "ProductConfiguration"("gelatoTemplateId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductConfiguration_shop_shopifyProductId_key" ON "ProductConfiguration"("shop", "shopifyProductId");

-- CreateIndex
CREATE INDEX "Prompt_shop_idx" ON "Prompt"("shop");

-- CreateIndex
CREATE INDEX "Prompt_shop_status_idx" ON "Prompt"("shop", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Prompt_shop_name_key" ON "Prompt"("shop", "name");

-- CreateIndex
CREATE INDEX "AiModel_shop_idx" ON "AiModel"("shop");

-- CreateIndex
CREATE INDEX "AiModel_shop_enabled_idx" ON "AiModel"("shop", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "AiModel_shop_modelKey_key" ON "AiModel"("shop", "modelKey");

-- CreateIndex
CREATE INDEX "GelatoTemplate_shop_idx" ON "GelatoTemplate"("shop");

-- CreateIndex
CREATE INDEX "GelatoTemplate_shop_gelatoTemplateId_idx" ON "GelatoTemplate"("shop", "gelatoTemplateId");

-- CreateIndex
CREATE INDEX "GelatoTemplate_productConfigurationId_idx" ON "GelatoTemplate"("productConfigurationId");

-- CreateIndex
CREATE INDEX "GelatoTemplate_shop_enabled_idx" ON "GelatoTemplate"("shop", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "ShopSetting_shop_key" ON "ShopSetting"("shop");

-- CreateIndex
CREATE INDEX "ShopSetting_shop_idx" ON "ShopSetting"("shop");

-- CreateIndex
CREATE INDEX "PendingOrder_shop_idx" ON "PendingOrder"("shop");

-- CreateIndex
CREATE INDEX "PendingOrder_shop_status_idx" ON "PendingOrder"("shop", "status");

-- CreateIndex
CREATE INDEX "PendingOrder_productConfigurationId_idx" ON "PendingOrder"("productConfigurationId");

-- CreateIndex
CREATE UNIQUE INDEX "PendingOrder_shop_shopifyOrderId_key" ON "PendingOrder"("shop", "shopifyOrderId");

-- CreateIndex
CREATE INDEX "GenerationLog_shop_idx" ON "GenerationLog"("shop");

-- CreateIndex
CREATE INDEX "GenerationLog_shop_status_idx" ON "GenerationLog"("shop", "status");

-- CreateIndex
CREATE INDEX "GenerationLog_createdAt_idx" ON "GenerationLog"("createdAt");

-- CreateIndex
CREATE INDEX "GenerationLog_productConfigurationId_idx" ON "GenerationLog"("productConfigurationId");

-- CreateIndex
CREATE INDEX "GenerationLog_productMappingId_idx" ON "GenerationLog"("productMappingId");

-- CreateIndex
CREATE INDEX "GenerationLog_aiModelId_idx" ON "GenerationLog"("aiModelId");

-- CreateIndex
CREATE INDEX "ProductMapping_shop_idx" ON "ProductMapping"("shop");

-- CreateIndex
CREATE INDEX "ProductMapping_shop_status_idx" ON "ProductMapping"("shop", "status");

-- CreateIndex
CREATE INDEX "ProductMapping_shop_shopifyProductNumericId_idx" ON "ProductMapping"("shop", "shopifyProductNumericId");

-- CreateIndex
CREATE INDEX "ProductMapping_shop_shopifyProductNumericId_status_idx" ON "ProductMapping"("shop", "shopifyProductNumericId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProductMapping_shop_shopifyProductId_designRef_key" ON "ProductMapping"("shop", "shopifyProductId", "designRef");

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

-- AddForeignKey
ALTER TABLE "ProductConfiguration" ADD CONSTRAINT "ProductConfiguration_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "Prompt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductConfiguration" ADD CONSTRAINT "ProductConfiguration_aiModelId_fkey" FOREIGN KEY ("aiModelId") REFERENCES "AiModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GelatoTemplate" ADD CONSTRAINT "GelatoTemplate_productConfigurationId_fkey" FOREIGN KEY ("productConfigurationId") REFERENCES "ProductConfiguration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingOrder" ADD CONSTRAINT "PendingOrder_productConfigurationId_fkey" FOREIGN KEY ("productConfigurationId") REFERENCES "ProductConfiguration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationLog" ADD CONSTRAINT "GenerationLog_productConfigurationId_fkey" FOREIGN KEY ("productConfigurationId") REFERENCES "ProductConfiguration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationLog" ADD CONSTRAINT "GenerationLog_productMappingId_fkey" FOREIGN KEY ("productMappingId") REFERENCES "ProductMapping"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationLog" ADD CONSTRAINT "GenerationLog_aiModelId_fkey" FOREIGN KEY ("aiModelId") REFERENCES "AiModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductMapping" ADD CONSTRAINT "ProductMapping_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "Prompt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductMapping" ADD CONSTRAINT "ProductMapping_aiModelId_fkey" FOREIGN KEY ("aiModelId") REFERENCES "AiModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customization" ADD CONSTRAINT "Customization_productMappingId_fkey" FOREIGN KEY ("productMappingId") REFERENCES "ProductMapping"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GelatoOrderItem" ADD CONSTRAINT "GelatoOrderItem_customizationId_fkey" FOREIGN KEY ("customizationId") REFERENCES "Customization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GelatoOrderItem" ADD CONSTRAINT "GelatoOrderItem_productMappingId_fkey" FOREIGN KEY ("productMappingId") REFERENCES "ProductMapping"("id") ON DELETE SET NULL ON UPDATE CASCADE;

