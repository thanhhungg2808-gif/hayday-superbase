# Kho Làng Hay Day – bản chạy thật (Supabase + Vercel)

Web tĩnh (HTML/CSS/JS) triển khai trên **Vercel**, dữ liệu và đăng nhập nằm ở **Supabase**
(Auth, PostgreSQL, Realtime, Storage). Khác với bản demo, dữ liệu dùng chung cho mọi khách,
và các thao tác về tiền/hàng chạy **trên server**, không thể sửa từ trình duyệt.

```
index.html  style.css  app.js  config.js  vercel.json
supabase/schema.sql      <- bảng, phân quyền RLS, hàm nghiệp vụ, dữ liệu mẫu
```

## Cách hoạt động và vì sao an toàn hơn bản demo
- Khách chỉ **đọc** được dữ liệu của chính mình (Row Level Security). Admin đọc được tất cả.
- Trình duyệt **không ghi trực tiếp** vào số dư, đơn hàng, kho, tin nhắn. Mọi thao tác đi qua hàm
  trên server (`place_order`, `cancel_order`, `review_topup`, `spin_wheel`…) kiểm tra quyền và chạy
  trong một giao dịch: hai khách mua cùng lúc không bán lố hàng, không ai tự cộng tiền hay lượt quay.
- Quy tắc kinh doanh nằm trong `schema.sql`: mua tối thiểu 10 cái/món (bội số của 10), 100 cái/đơn,
  trên 1000 cái giảm 10%, hoàn tiền khi hủy, tỉ lệ vòng quay do server chọn.
- Mật khẩu do Supabase Auth quản lý (không còn tự băm trong trình duyệt).

## Triển khai từng bước

### 1. Tạo dự án Supabase
1. Vào https://supabase.com, đăng nhập, **New project** (nên chọn vùng *Southeast Asia – Singapore*).
2. Đặt mật khẩu cơ sở dữ liệu và lưu lại.

### 2. Tắt xác nhận email
Trang dùng "tên đăng nhập" nên email chỉ là tên nội bộ (`tên@hayday-shop.vn`), không gửi thư thật.
- **Authentication → Sign In / Providers → Email**: **tắt “Confirm email”**, giữ bật “Enable sign ups”.
- Nếu đăng ký báo *Email address is invalid*, đổi `EMAIL_DOMAIN` trong `config.js` sang một tên miền thật
  (ví dụ tên miền của bạn).

### 3. Tạo bảng và hàm
**SQL Editor → New query**, dán toàn bộ `supabase/schema.sql`, bấm **Run**.
Có thể chạy lại nhiều lần mà không mất dữ liệu. Script tạo 9 bảng, phân quyền, 14 hàm nghiệp vụ,
15 vật phẩm mẫu, vòng quay mặc định và kho ảnh `product-images`.

> Lưu ý: script có lệnh `revoke` trên mọi bảng trong schema `public`. Nếu dự án Supabase của bạn còn
> bảng khác, hãy xem lại phần "Quyền ở mức bảng" trước khi chạy.

### 4. Điền cấu hình
Mở `config.js`, điền hai giá trị lấy tại **Project Settings → API**:
- `SUPABASE_URL` = Project URL
- `SUPABASE_ANON_KEY` = khóa **anon / public**

Không bao giờ dán khóa `service_role` vào đây.

### 5. Chạy thử trên máy
Mở thư mục bằng VS Code, cài **Live Server**, chuột phải `index.html` → *Open with Live Server*.
Hoặc: `python -m http.server 8000` rồi vào `http://localhost:8000`.

### 6. Tạo tài khoản admin đầu tiên
1. Trên trang, bấm **Tạo tài khoản**, đăng ký tên bạn muốn (ví dụ `admin`) với mật khẩu mạnh.
2. Trong **SQL Editor** chạy (đổi `admin` thành tên vừa đăng ký):
   ```sql
   update public.profiles set role = 'admin' where lower(username) = 'admin';
   ```
3. Tải lại trang và đăng nhập lại: menu **Quản trị** xuất hiện.

### 7. Đưa lên Vercel
1. Đẩy thư mục lên một repo GitHub (đã có `.gitignore`).
2. Vercel → **Add New → Project** → chọn repo.
3. **Framework Preset: Other**, để trống *Build Command* và *Output Directory*, bấm **Deploy**.
   (Hoặc dùng CLI: `npm i -g vercel` rồi chạy `vercel --prod` trong thư mục này.)
4. Mỗi lần `git push`, Vercel tự triển khai lại.

### 8. Hoàn tất
- **Supabase → Authentication → URL Configuration**: đặt *Site URL* là địa chỉ Vercel của bạn.
- Gắn tên miền riêng ở Vercel → *Settings → Domains*.
- Vào trang thật, đăng nhập admin, kiểm tra **Quản trị → Cài đặt** (số MoMo, lưu ý khi mua).

## Danh sách kiểm tra sau khi triển khai
Làm ngay sau khi lên mạng, nhất là phần bảo mật:
- [ ] Đăng ký một khách thử, nạp tiền → admin duyệt → khách mua hàng → admin đánh dấu thành công → khách hủy một đơn khác: số dư, kho, tồn kho đều khớp.
- [ ] Thử gian lận bằng Console của trình duyệt (F12) với tài khoản khách, tất cả phải **bị từ chối**:
  ```js
  await sb.from('profiles').update({ balance: 999999999 }).eq('id', sess)      // phải lỗi
  await sb.from('orders').insert({ username: 'x', items: [], subtotal: 1, total: 1 })  // phải lỗi
  await sb.rpc('review_topup', { p_topup: '00000000-0000-0000-0000-000000000000', p_approve: true }) // phải lỗi (không phải admin)
  ```
- [ ] Đăng nhập hai khách khác nhau: mỗi người chỉ thấy đơn, kho, chat của mình.
- [ ] Đổi mật khẩu tài khoản admin, dùng mật khẩu mạnh, không dùng lại ở nơi khác.
- [ ] **Authentication → Attack Protection**: bật CAPTCHA (hCaptcha/Turnstile) nếu bị đăng ký rác.
- [ ] Bật sao lưu: gói Free không có sao lưu tự động. Nên nâng cấp Pro hoặc xuất dữ liệu định kỳ.

## Đổi quy tắc kinh doanh
Các con số 10 / 10 / 100 / 1000 / 10% nằm ở **hai nơi**, phải sửa đồng bộ:
1. `supabase/schema.sql` → hàm `place_order` (các hằng số `c_...` ở đầu hàm). Đây là nơi quyết định thật.
2. `app.js` → `MIN_ITEM`, `STEP_QTY`, `MIN_ORDER`, `DISCOUNT_QTY`, `DISCOUNT_PCT` (chỉ để hiển thị và báo lỗi sớm).

Số MoMo, lưu ý khi mua, phần thưởng và tỉ lệ vòng quay, mốc lượt quay chỉnh ngay trong trang **Quản trị**.

## Xử lý sự cố
| Hiện tượng | Cách xử lý |
|---|---|
| Trang báo "Chưa cấu hình Supabase" | Điền `config.js` (bước 4). |
| "Không tải được dữ liệu" | Chưa chạy `schema.sql`, hoặc URL/anon key sai. |
| Đăng ký xong báo cần xác nhận email | Tắt "Confirm email" (bước 2). |
| Đăng ký báo email không hợp lệ | Đổi `EMAIL_DOMAIN` sang tên miền thật. |
| Không thấy menu Quản trị | Chưa chạy lệnh `update ... role = 'admin'` hoặc chưa đăng nhập lại. |
| Admin đổi mật khẩu khách báo lỗi | Đặt lại ở Supabase → Authentication → Users. |
| Chat không tự cập nhật | Kiểm tra bảng đã nằm trong publication `supabase_realtime` (Database → Replication). |
| Tải ảnh sản phẩm lỗi | Kiểm tra bucket `product-images` tồn tại và tài khoản đang là admin. |

## Việc nên làm tiếp
- Nạp tiền tự động: kết nối cổng thanh toán hoặc dịch vụ đối soát giao dịch (PayOS, SePay, Casso, MoMo Business…) qua một Supabase Edge Function, thay cho việc duyệt tay.
- Thông báo cho admin khi có đơn hoặc yêu cầu nạp tiền (Telegram/Email) bằng Database Webhook.
- Điều khoản sử dụng, chính sách bảo mật, chính sách hoàn tiền. Tìm hiểu quy định của Supercell về mua bán vật phẩm, thuế và đăng ký kinh doanh.
