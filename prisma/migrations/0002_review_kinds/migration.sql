-- CreateEnum
CREATE TYPE "ReviewKind" AS ENUM ('itinerary', 'property');

-- AlterTable
ALTER TABLE "Attendee" ADD COLUMN     "stayEnd" DATE,
ADD COLUMN     "stayStart" DATE;

-- AlterTable
ALTER TABLE "Retreat" ADD COLUMN     "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "kind" "ReviewKind" NOT NULL DEFAULT 'itinerary',
ADD COLUMN     "propertyAddress" TEXT,
ALTER COLUMN "startDate" DROP NOT NULL,
ALTER COLUMN "endDate" DROP NOT NULL;

-- AlterTable
ALTER TABLE "TenantRequest" ADD COLUMN     "reviewKinds" "ReviewKind"[] DEFAULT ARRAY[]::"ReviewKind"[];

