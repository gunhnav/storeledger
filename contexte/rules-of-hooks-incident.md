# Bài học sự cố: Vi phạm Rules of Hooks làm trắng trang báo cáo

Tài liệu đúc rút kinh nghiệm từ sự cố nghiêm trọng tại commit `3f266d9`.

---

## 1. Bản chất sự cố

Trong lần refactor tại commit `3f266d9`, AI đã tự ý thêm các Hook `useMemo` tính toán số liệu thống kê vào các component:
- `src/pages/RevenueReport.tsx`
- `src/pages/ExpenseReport.tsx`
- `src/pages/ItemSalesPage.tsx`

Tuy nhiên, các `useMemo` này lại được đặt **SAU** các câu lệnh `return` sớm kiểm tra dữ liệu loading hoặc rỗng:

```tsx
// ❌ SAI LẦM NGHIÊM TRỌNG:
export function RevenueReport() {
  const [data, setData] = useState(...)
  
  if (!data) {
    return <LoadingSpinner /> // ⚠️ Return sớm ở đây!
  }

  // 💥 VI PHẠM: useMemo nằm sau return sớm!
  const stats = useMemo(() => calculateStats(data), [data])
  
  return <div>{...}</div>
}
```

### Hậu quả:
Khi dữ liệu thay đổi giữa trạng thái loading và có dữ liệu, thứ tự thực thi Hook giữa các lần render bị thay đổi (`Rendered fewer hooks than expected`). React ném ngoại lệ Runtime Error làm **toàn bộ 3 màn hình báo cáo bị trắng xoá hoàn toàn**.

---

## 2. Giải pháp khắc phục triệt để

1. **Khôi phục nguyên trạng**: Đã khôi phục cả 3 file về trạng thái an toàn trước đó tại commit `68ec7f2`.
2. **Quy tắc bất di bất dịch**:
   - Mọi Hook (`useState`, `useMemo`, `useEffect`, `useCallback`, `useRef`) **BẮT BUỘC** phải được khai báo ở đầu component body, trước bất kỳ lệnh `if` hay `return` sớm nào.
   - Nếu cần tính toán phụ thuộc điều kiện, thực hiện logic bên trong hàm callback của `useMemo`, không bọc điều kiện bên ngoài Hook.

```tsx
// ✅ CÁCH LÀM ĐÚNG CHUẨN:
export function RevenueReport() {
  const [data, setData] = useState(...)
  
  // Hook luôn đặt ở đầu, trước mọi lệnh return:
  const stats = useMemo(() => {
    if (!data) return null
    return calculateStats(data)
  }, [data])

  if (!data) {
    return <LoadingSpinner />
  }

  return <div>{...}</div>
}
```

3. **Cơ chế chốt chặn tự động**:
   - Thiết lập linter `oxlint` với quy tắc `react/rules-of-hooks` trong script `yarn lint`.
   - Bắt buộc chạy `yarn lint` và xác nhận 0 lỗi trước khi thực hiện commit.
