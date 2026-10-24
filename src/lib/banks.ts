// Ngân hàng hay dùng cho QR VietQR: mã theo img.vietqr.io và tên hiển thị
export const BANKS: { code: string; name: string }[] = [
  { code: 'VCB', name: 'Vietcombank' },
  { code: 'TCB', name: 'Techcombank' },
  { code: 'MB', name: 'MB Bank' },
  { code: 'ACB', name: 'ACB' },
  { code: 'VPB', name: 'VPBank' },
  { code: 'BIDV', name: 'BIDV' },
  { code: 'ICB', name: 'VietinBank' },
  { code: 'VBA', name: 'Agribank' },
  { code: 'TPB', name: 'TPBank' },
  { code: 'STB', name: 'Sacombank' },
  { code: 'VIB', name: 'VIB' },
  { code: 'HDB', name: 'HDBank' },
  { code: 'OCB', name: 'OCB' },
  { code: 'MSB', name: 'MSB' },
  { code: 'SHB', name: 'SHB' },
  { code: 'SEAB', name: 'SeABank' },
  { code: 'EIB', name: 'Eximbank' },
  { code: 'LPB', name: 'LPBank' },
  { code: 'NAB', name: 'Nam A Bank' },
]

export const bankName = (code: string | null | undefined) => BANKS.find((b) => b.code === code)?.name ?? code ?? ''
