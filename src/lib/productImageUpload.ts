// Tải ảnh món lên Supabase Storage (bucket product-images). Policy chỉ cho admin ghi / xoá
// (supabase/migrations/20261107044100_product_images.sql).
import { supabase } from './supabase'
import { PRODUCT_IMAGE_BUCKET, imagePath, storagePathFromUrl } from './productImage'

function storageError(error: { message?: string } | null): Error {
  const msg = error?.message ?? ''
  if (/row-level security|unauthorized|not allowed/i.test(msg)) return new Error('Chỉ quản trị viên được tải ảnh món')
  if (/exceeded|too large|payload/i.test(msg)) return new Error('Ảnh quá lớn (tối đa 15MB)')
  return new Error(msg || 'Không tải được ảnh lên')
}

// Trả về URL công khai của ảnh vừa tải
export async function uploadProductImage(blob: Blob, storeId: string, productId: string): Promise<string> {
  const path = imagePath(storeId, productId)
  const { error } = await supabase.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .upload(path, blob, { contentType: 'image/webp', cacheControl: '31536000', upsert: false })
  if (error) throw storageError(error)
  return supabase.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl
}

// Xoá file cũ trong bucket; bỏ qua ảnh tĩnh / URL ngoài bucket
export async function removeProductImage(url: string | null | undefined): Promise<void> {
  const path = storagePathFromUrl(url)
  if (!path) return
  const { error } = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([path])
  if (error) throw storageError(error)
}
