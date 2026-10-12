-- AlterTable
ALTER TABLE "Customization" ADD COLUMN "configSnapshot" JSONB;

-- AlterTable
ALTER TABLE "ProductMapping" ADD COLUMN "backgroundImageKey" TEXT;
ALTER TABLE "ProductMapping" ADD COLUMN "backgroundImageName" TEXT;
ALTER TABLE "ProductMapping" ADD COLUMN "backgroundPlaceholderName" TEXT;
ALTER TABLE "ProductMapping" ADD COLUMN "mockupTemplate" TEXT;
ALTER TABLE "ProductMapping" ADD COLUMN "pricingRules" JSONB;
ALTER TABLE "ProductMapping" ADD COLUMN "printFileRequirements" TEXT;
ALTER TABLE "ProductMapping" ADD COLUMN "shippingRules" JSONB;
ALTER TABLE "ProductMapping" ADD COLUMN "supplierSku" TEXT;
