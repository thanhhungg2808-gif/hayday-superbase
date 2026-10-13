/*
 * Cấu hình kết nối Supabase.
 * Lấy hai giá trị đầu tại: Supabase Dashboard → Project Settings → API
 *   - Project URL        → SUPABASE_URL
 *   - anon / public key  → SUPABASE_ANON_KEY
 *
 * Anon key được phép công khai trên trình duyệt: dữ liệu được bảo vệ bởi
 * Row Level Security trong supabase/schema.sql. TUYỆT ĐỐI KHÔNG dán
 * "service_role" key vào đây.
 */
window.APP_CONFIG = {
  SUPABASE_URL: 'https://YOUR-PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR-ANON-KEY',
  // Supabase Auth cần email, nên tên đăng nhập được đổi thành "tên@EMAIL_DOMAIN".
  // Không có email nào được gửi đi (đã tắt xác nhận email). Chỉ cần là tên miền đúng định dạng.
  EMAIL_DOMAIN: 'hayday-shop.vn'
};
