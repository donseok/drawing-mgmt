-- =============================================================================
-- 20260426000000_init — baseline migration
-- Generated from prisma migrate diff --from-empty --to-schema-datamodel
-- with pgvector / pgcrypto / pg_trgm extensions prepended.
--
-- This is the initial migration that creates the full schema from scratch.
-- Existing databases should mark this as applied via:
--   prisma migrate resolve --applied 20260426000000_init
-- =============================================================================

-- ----------------------------------------------------------------------------
-- Extensions (pgvector, pgcrypto, pg_trgm)
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'USER', 'PARTNER');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('ACTIVE', 'RETIRED', 'PARTNER');

-- CreateEnum
CREATE TYPE "ObjectState" AS ENUM ('NEW', 'CHECKED_OUT', 'CHECKED_IN', 'IN_APPROVAL', 'APPROVED', 'DELETED');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StepStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AttrType" AS ENUM ('TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'COMBO');

-- CreateEnum
CREATE TYPE "PartType" AS ENUM ('FOLDER_CODE', 'LITERAL', 'SEQUENCE', 'YEAR');

-- CreateEnum
CREATE TYPE "PrincipalType" AS ENUM ('USER', 'ORG', 'GROUP');

-- CreateEnum
CREATE TYPE "LobbyStatus" AS ENUM ('NEW', 'IN_REVIEW', 'IN_APPROVAL', 'COMPLETED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "LobbyReplyDecision" AS ENUM ('COMMENT', 'APPROVE', 'REJECT', 'REVISE_REQUESTED');

-- CreateEnum
CREATE TYPE "ConversionStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "ChatRole" AS ENUM ('SYSTEM', 'USER', 'ASSISTANT', 'TOOL');

-- CreateEnum
CREATE TYPE "ChatMode" AS ENUM ('RAG', 'RULE');

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "email" TEXT,
    "fullName" TEXT NOT NULL,
    "organizationId" TEXT,
    "employmentType" "EmploymentType" NOT NULL DEFAULT 'ACTIVE',
    "role" "Role" NOT NULL DEFAULT 'USER',
    "securityLevel" INTEGER NOT NULL DEFAULT 5,
    "signatureFile" TEXT,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserGroup" (
    "userId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,

    CONSTRAINT "UserGroup_pkey" PRIMARY KEY ("userId","groupId")
);

-- CreateTable
CREATE TABLE "Folder" (
    "id" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "folderCode" TEXT NOT NULL,
    "defaultClassId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Folder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FolderPermission" (
    "id" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "principalType" "PrincipalType" NOT NULL,
    "principalId" TEXT NOT NULL,
    "viewFolder" BOOLEAN NOT NULL DEFAULT false,
    "editFolder" BOOLEAN NOT NULL DEFAULT false,
    "viewObject" BOOLEAN NOT NULL DEFAULT false,
    "editObject" BOOLEAN NOT NULL DEFAULT false,
    "deleteObject" BOOLEAN NOT NULL DEFAULT false,
    "approveObject" BOOLEAN NOT NULL DEFAULT false,
    "download" BOOLEAN NOT NULL DEFAULT false,
    "print" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "FolderPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObjectEntity" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "folderId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "securityLevel" INTEGER NOT NULL DEFAULT 5,
    "state" "ObjectState" NOT NULL DEFAULT 'NEW',
    "ownerId" TEXT NOT NULL,
    "currentRevision" INTEGER NOT NULL DEFAULT 0,
    "currentVersion" DECIMAL(5,1) NOT NULL DEFAULT 0.0,
    "lockedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ObjectEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObjectClass" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "ObjectClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObjectAttribute" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "dataType" "AttrType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "defaultValue" TEXT,
    "comboItems" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ObjectAttribute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObjectAttributeValue" (
    "id" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "attributeId" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "ObjectAttributeValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinkedObject" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "relationType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkedObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserFolderPin" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserFolderPin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserObjectPin" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserObjectPin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Revision" (
    "id" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "rev" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Version" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "ver" DECIMAL(5,1) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "comment" TEXT,

    CONSTRAINT "Version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "isMaster" BOOLEAN NOT NULL DEFAULT false,
    "checksumSha256" TEXT NOT NULL,
    "pdfPath" TEXT,
    "dxfPath" TEXT,
    "svgPath" TEXT,
    "thumbnailPath" TEXT,
    "conversionStatus" "ConversionStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NumberRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "classId" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "NumberRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NumberRulePart" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "type" "PartType" NOT NULL,
    "value" TEXT,
    "digits" INTEGER,
    "initial" INTEGER,
    "order" INTEGER NOT NULL,

    CONSTRAINT "NumberRulePart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requesterId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalStep" (
    "id" TEXT NOT NULL,
    "approvalId" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "status" "StepStatus" NOT NULL DEFAULT 'PENDING',
    "comment" TEXT,
    "signatureFile" TEXT,
    "actedAt" TIMESTAMP(3),

    CONSTRAINT "ApprovalStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lobby" (
    "id" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "expiresAt" TIMESTAMP(3),
    "status" "LobbyStatus" NOT NULL DEFAULT 'NEW',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lobby_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LobbyAttachment" (
    "id" TEXT NOT NULL,
    "lobbyId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LobbyAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LobbyTargetCompany" (
    "id" TEXT NOT NULL,
    "lobbyId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "LobbyTargetCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LobbyReply" (
    "id" TEXT NOT NULL,
    "lobbyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "decision" "LobbyReplyDecision" NOT NULL DEFAULT 'COMMENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LobbyReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversionJob" (
    "id" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "status" "ConversionStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversionJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "objectId" TEXT,
    "action" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemLog" (
    "id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notice" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isPopup" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "publishFrom" TIMESTAMP(3) NOT NULL,
    "publishTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" "ChatRole" NOT NULL,
    "content" TEXT NOT NULL,
    "toolCalls" JSONB,
    "toolResults" JSONB,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "model" TEXT,
    "mode" "ChatMode" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualChunk" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManualChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "scopes" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- ----------------------------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------------------------

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");

-- CreateIndex
CREATE INDEX "Organization_parentId_idx" ON "Organization"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Group_name_key" ON "Group"("name");

-- CreateIndex
CREATE INDEX "UserGroup_groupId_idx" ON "UserGroup"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "Folder_folderCode_key" ON "Folder"("folderCode");

-- CreateIndex
CREATE INDEX "Folder_parentId_idx" ON "Folder"("parentId");

-- CreateIndex
CREATE INDEX "Folder_folderCode_idx" ON "Folder"("folderCode");

-- CreateIndex
CREATE INDEX "FolderPermission_principalType_principalId_idx" ON "FolderPermission"("principalType", "principalId");

-- CreateIndex
CREATE UNIQUE INDEX "FolderPermission_folderId_principalType_principalId_key" ON "FolderPermission"("folderId", "principalType", "principalId");

-- CreateIndex
CREATE UNIQUE INDEX "ObjectEntity_number_key" ON "ObjectEntity"("number");

-- CreateIndex
CREATE INDEX "ObjectEntity_folderId_state_idx" ON "ObjectEntity"("folderId", "state");

-- CreateIndex
CREATE INDEX "ObjectEntity_number_idx" ON "ObjectEntity"("number");

-- CreateIndex
CREATE INDEX "ObjectEntity_ownerId_idx" ON "ObjectEntity"("ownerId");

-- CreateIndex
CREATE INDEX "ObjectEntity_classId_idx" ON "ObjectEntity"("classId");

-- CreateIndex
CREATE INDEX "ObjectEntity_state_deletedAt_idx" ON "ObjectEntity"("state", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ObjectClass_code_key" ON "ObjectClass"("code");

-- CreateIndex
CREATE INDEX "ObjectAttribute_classId_idx" ON "ObjectAttribute"("classId");

-- CreateIndex
CREATE UNIQUE INDEX "ObjectAttribute_classId_code_key" ON "ObjectAttribute"("classId", "code");

-- CreateIndex
CREATE INDEX "ObjectAttributeValue_attributeId_value_idx" ON "ObjectAttributeValue"("attributeId", "value");

-- CreateIndex
CREATE UNIQUE INDEX "ObjectAttributeValue_objectId_attributeId_key" ON "ObjectAttributeValue"("objectId", "attributeId");

-- CreateIndex
CREATE UNIQUE INDEX "LinkedObject_sourceId_targetId_key" ON "LinkedObject"("sourceId", "targetId");

-- CreateIndex
CREATE INDEX "UserFolderPin_userId_sortOrder_idx" ON "UserFolderPin"("userId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "UserFolderPin_userId_folderId_key" ON "UserFolderPin"("userId", "folderId");

-- CreateIndex
CREATE INDEX "UserObjectPin_userId_sortOrder_idx" ON "UserObjectPin"("userId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "UserObjectPin_userId_objectId_key" ON "UserObjectPin"("userId", "objectId");

-- CreateIndex
CREATE UNIQUE INDEX "Revision_objectId_rev_key" ON "Revision"("objectId", "rev");

-- CreateIndex
CREATE UNIQUE INDEX "Version_revisionId_ver_key" ON "Version"("revisionId", "ver");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_storagePath_key" ON "Attachment"("storagePath");

-- CreateIndex
CREATE INDEX "Attachment_versionId_idx" ON "Attachment"("versionId");

-- CreateIndex
CREATE INDEX "Attachment_conversionStatus_idx" ON "Attachment"("conversionStatus");

-- CreateIndex
CREATE INDEX "NumberRulePart_ruleId_idx" ON "NumberRulePart"("ruleId");

-- CreateIndex
CREATE UNIQUE INDEX "Approval_revisionId_key" ON "Approval"("revisionId");

-- CreateIndex
CREATE INDEX "Approval_status_createdAt_idx" ON "Approval"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Approval_requesterId_idx" ON "Approval"("requesterId");

-- CreateIndex
CREATE INDEX "ApprovalStep_approverId_status_idx" ON "ApprovalStep"("approverId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalStep_approvalId_order_key" ON "ApprovalStep"("approvalId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "LobbyTargetCompany_lobbyId_companyId_key" ON "LobbyTargetCompany"("lobbyId", "companyId");

-- CreateIndex
CREATE INDEX "LobbyReply_lobbyId_createdAt_idx" ON "LobbyReply"("lobbyId", "createdAt");

-- CreateIndex
CREATE INDEX "ConversionJob_status_createdAt_idx" ON "ConversionJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ConversionJob_attachmentId_idx" ON "ConversionJob"("attachmentId");

-- CreateIndex
CREATE INDEX "ActivityLog_userId_createdAt_idx" ON "ActivityLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_objectId_createdAt_idx" ON "ActivityLog"("objectId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_action_createdAt_idx" ON "ActivityLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "SystemLog_level_createdAt_idx" ON "SystemLog"("level", "createdAt");

-- CreateIndex
CREATE INDEX "SystemLog_category_createdAt_idx" ON "SystemLog"("category", "createdAt");

-- CreateIndex
CREATE INDEX "ChatSession_userId_updatedAt_idx" ON "ChatSession"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "ChatMessage_sessionId_createdAt_idx" ON "ChatMessage"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "ManualChunk_source_idx" ON "ManualChunk"("source");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_prefix_key" ON "ApiKey"("prefix");

-- ----------------------------------------------------------------------------
-- Foreign Keys
-- ----------------------------------------------------------------------------

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserGroup" ADD CONSTRAINT "UserGroup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserGroup" ADD CONSTRAINT "UserGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_defaultClassId_fkey" FOREIGN KEY ("defaultClassId") REFERENCES "ObjectClass"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FolderPermission" ADD CONSTRAINT "FolderPermission_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectEntity" ADD CONSTRAINT "ObjectEntity_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectEntity" ADD CONSTRAINT "ObjectEntity_classId_fkey" FOREIGN KEY ("classId") REFERENCES "ObjectClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectEntity" ADD CONSTRAINT "ObjectEntity_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectEntity" ADD CONSTRAINT "ObjectEntity_lockedById_fkey" FOREIGN KEY ("lockedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectAttribute" ADD CONSTRAINT "ObjectAttribute_classId_fkey" FOREIGN KEY ("classId") REFERENCES "ObjectClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectAttributeValue" ADD CONSTRAINT "ObjectAttributeValue_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "ObjectEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectAttributeValue" ADD CONSTRAINT "ObjectAttributeValue_attributeId_fkey" FOREIGN KEY ("attributeId") REFERENCES "ObjectAttribute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkedObject" ADD CONSTRAINT "LinkedObject_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ObjectEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkedObject" ADD CONSTRAINT "LinkedObject_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "ObjectEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFolderPin" ADD CONSTRAINT "UserFolderPin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFolderPin" ADD CONSTRAINT "UserFolderPin_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserObjectPin" ADD CONSTRAINT "UserObjectPin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserObjectPin" ADD CONSTRAINT "UserObjectPin_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "ObjectEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Revision" ADD CONSTRAINT "Revision_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "ObjectEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Version" ADD CONSTRAINT "Version_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "Revision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "Version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NumberRulePart" ADD CONSTRAINT "NumberRulePart_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "NumberRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "Revision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalStep" ADD CONSTRAINT "ApprovalStep_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "Approval"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalStep" ADD CONSTRAINT "ApprovalStep_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LobbyAttachment" ADD CONSTRAINT "LobbyAttachment_lobbyId_fkey" FOREIGN KEY ("lobbyId") REFERENCES "Lobby"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LobbyTargetCompany" ADD CONSTRAINT "LobbyTargetCompany_lobbyId_fkey" FOREIGN KEY ("lobbyId") REFERENCES "Lobby"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LobbyReply" ADD CONSTRAINT "LobbyReply_lobbyId_fkey" FOREIGN KEY ("lobbyId") REFERENCES "Lobby"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversionJob" ADD CONSTRAINT "ConversionJob_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "Attachment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "ObjectEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ----------------------------------------------------------------------------
-- pgvector: ManualChunk.embedding column + ivfflat ANN index
-- (Prisma cannot manage vector columns natively)
-- ----------------------------------------------------------------------------
ALTER TABLE "ManualChunk"
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

CREATE INDEX IF NOT EXISTS manual_chunk_emb_idx
  ON "ManualChunk"
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- ----------------------------------------------------------------------------
-- Trigram GIN indexes for Korean partial-match full-text search
-- (TRD S3.4 — pg_trgm + GIN until mecab-ko / textsearch_ko adopted)
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS object_entity_name_trgm_idx
  ON "ObjectEntity"
  USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS object_entity_description_trgm_idx
  ON "ObjectEntity"
  USING GIN (description gin_trgm_ops);

CREATE INDEX IF NOT EXISTS object_entity_number_trgm_idx
  ON "ObjectEntity"
  USING GIN (number gin_trgm_ops);
