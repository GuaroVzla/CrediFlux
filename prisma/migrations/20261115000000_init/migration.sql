-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'USER');

-- CreateEnum
CREATE TYPE "LicenseStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'SUSPENDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "TrustTier" AS ENUM ('ALTO', 'MEDIO', 'RIESGOSO');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "legacyId" TEXT,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "companyName" TEXT,
    "email" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "passwordHash" TEXT,
    "passwordLegacy" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "monthlyCapitals" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "License" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "licenseKey" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'standard',
    "status" "LicenseStatus" NOT NULL DEFAULT 'ACTIVE',
    "durationMonths" INTEGER NOT NULL DEFAULT 1,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "notes" TEXT,
    "issuedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "License_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminSetting" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL DEFAULT 'CrediFlux',
    "currency" TEXT NOT NULL DEFAULT '$',
    "ecommerceCapital" DOUBLE PRECISION NOT NULL DEFAULT 5000,
    "timezone" TEXT NOT NULL DEFAULT 'America/Caracas',
    "aiProvider" TEXT NOT NULL DEFAULT 'ocrspace',
    "aiAutoAssignEnabled" BOOLEAN NOT NULL DEFAULT true,
    "aiRoutingRules" JSONB,
    "ocrConfidenceMin" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "ocrApiKeys" JSONB,
    "providerConfig" JSONB,
    "featureFlags" JSONB,
    "metadata" JSONB,
    "systemLicenseKey" TEXT,
    "adminPasswordHash" TEXT,
    "adminPasswordLegacy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustLevelConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tier" "TrustTier" NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "criteria" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrustLevelConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptPattern" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "legacyId" TEXT,
    "bankName" TEXT NOT NULL,
    "keywords" JSONB,
    "referenceFormat" TEXT,
    "referenceRegex" TEXT,
    "notes" TEXT,
    "imageKey" TEXT,
    "imageUrl" TEXT,
    "imageMime" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT,
    "extra" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReceiptPattern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettingAuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorId" TEXT,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettingAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppState" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE INDEX "User_tenantId_role_idx" ON "User"("tenantId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_username_key" ON "User"("tenantId", "username");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_legacyId_key" ON "User"("tenantId", "legacyId");

-- CreateIndex
CREATE UNIQUE INDEX "License_userId_key" ON "License"("userId");

-- CreateIndex
CREATE INDEX "License_tenantId_status_expiresAt_idx" ON "License"("tenantId", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "License_tenantId_licenseKey_key" ON "License"("tenantId", "licenseKey");

-- CreateIndex
CREATE UNIQUE INDEX "AdminSetting_tenantId_key" ON "AdminSetting"("tenantId");

-- CreateIndex
CREATE INDEX "TrustLevelConfig_tenantId_isActive_sortOrder_idx" ON "TrustLevelConfig"("tenantId", "isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "TrustLevelConfig_tenantId_tier_key" ON "TrustLevelConfig"("tenantId", "tier");

-- CreateIndex
CREATE INDEX "ReceiptPattern_tenantId_bankName_idx" ON "ReceiptPattern"("tenantId", "bankName");

-- CreateIndex
CREATE INDEX "ReceiptPattern_tenantId_isActive_idx" ON "ReceiptPattern"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptPattern_tenantId_legacyId_key" ON "ReceiptPattern"("tenantId", "legacyId");

-- CreateIndex
CREATE INDEX "SettingAuditLog_tenantId_entity_createdAt_idx" ON "SettingAuditLog"("tenantId", "entity", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "License" ADD CONSTRAINT "License_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "License" ADD CONSTRAINT "License_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminSetting" ADD CONSTRAINT "AdminSetting_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustLevelConfig" ADD CONSTRAINT "TrustLevelConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptPattern" ADD CONSTRAINT "ReceiptPattern_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettingAuditLog" ADD CONSTRAINT "SettingAuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettingAuditLog" ADD CONSTRAINT "SettingAuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

