-- An explicit Yes/No answer about using guest photos for marketing (null = not answered).
ALTER TABLE "Response" ADD COLUMN "consentPhotoMarketing" BOOLEAN;
