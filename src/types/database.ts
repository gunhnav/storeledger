// Kiểu dữ liệu viết tay, khớp với supabase/migrations/0001_init.sql.
// Có thể dùng với createClient<Database>(...).
// Cột numeric được PostgREST trả về dạng number; date dạng 'YYYY-MM-DD'; timestamptz dạng chuỗi ISO.

export type UserRole = 'admin' | 'staff'
export type SaleChannel = 'in_store' | 'shopeefood' | 'company'
export type StockStatus = 'ok' | 'low' | 'out'
export type PnlPeriod = 'day' | 'week' | 'month'

// ---------------------------------------------------------------------------
// Bảng
// ---------------------------------------------------------------------------

export type Profile = {
  id: string
  full_name: string | null
  role: UserRole
  created_at: string
}

export type Store = {
  id: string
  code: string
  name: string
  default_commission_rate: number
  created_at: string
}

export type StoreMember = {
  store_id: string
  user_id: string
}

export type Product = {
  id: string
  store_id: string
  name: string
  category: string | null
  tracks_stock: boolean
  low_stock_threshold: number
  is_active: boolean
  created_at: string
}

// Lịch sử giá theo ngày áp dụng (chỉ admin đọc). unit_cost null = chưa có giá vốn.
// supabase/migrations/20261018032417_product_price_history.sql
export type ProductPrice = {
  id: string
  product_id: string
  effective_from: string
  sale_price: number
  app_price: number | null
  unit_cost: number | null
  note: string | null
  created_by: string | null
  created_at: string
}

export type Purchase = {
  id: string
  store_id: string
  purchase_date: string
  note: string | null
  created_by: string | null
  created_at: string
}

export type StockBatch = {
  id: string
  purchase_id: string
  store_id: string
  product_id: string
  received_date: string
  initial_qty: number
  unit_cost: number
  qty_home: number
  qty_shop: number
  qty_company: number
  created_at: string
}

export type StockTransfer = {
  id: string
  store_id: string
  product_id: string
  quantity: number
  transfer_date: string
  note: string | null
  destination: TransferDestination
  created_by: string | null
  created_at: string
}

export type Sale = {
  id: string
  store_id: string
  sale_date: string
  channel: SaleChannel
  commission_rate: number
  total_amount: number
  note: string | null
  created_by: string | null
  created_at: string
}

export type SaleItem = {
  id: string
  sale_id: string
  product_id: string
  quantity: number
  unit_price: number
}

export type SaleItemCostLine = {
  id: string
  sale_item_id: string
  batch_id: string | null
  quantity: number
  unit_cost: number
}

export type Expense = {
  id: string
  store_id: string
  expense_date: string
  category: string
  // Thành tiền (mặc định = quantity × unit_price, cho phép ghi đè)
  amount: number
  quantity: number
  unit_price: number
  note: string | null
  // Khoản chi sinh từ đợt nhập kho (báo cáo lãi lỗ bỏ qua, xem 20261019090000_purchase_expenses.sql)
  purchase_id: string | null
  created_by: string | null
  created_at: string
}

// Dữ liệu ghi được từ client (chỉ admin, RLS kiểm tra)

export type StoreInsert = {
  id?: string
  code: string
  name: string
  default_commission_rate?: number
  created_at?: string
}
export type StoreUpdate = Partial<StoreInsert>

export type StoreMemberInsert = StoreMember
export type StoreMemberUpdate = Partial<StoreMember>

export type ProductInsert = {
  id?: string
  store_id: string
  name: string
  category?: string | null
  tracks_stock?: boolean
  low_stock_threshold?: number
  is_active?: boolean
  created_at?: string
}
export type ProductUpdate = Partial<ProductInsert>

export type ExpenseInsert = {
  id?: string
  store_id: string
  expense_date?: string
  category: string
  amount: number
  quantity?: number
  unit_price: number
  note?: string | null
  created_by?: string | null
  created_at?: string
}

// Nhân viên chỉ được sửa full_name của chính mình
export type ProfileUpdate = {
  full_name?: string | null
}

// ---------------------------------------------------------------------------
// Hàm RPC
// ---------------------------------------------------------------------------

// unit_cost null: DB lấy giá vốn có hiệu lực vào ngày nhập
export type PurchaseItemInput = {
  product_id: string
  quantity: number
  unit_cost: number | null
}

export type SaleItemInput = {
  product_id: string
  quantity: number
  unit_price: number
}

export type CreatePurchaseArgs = {
  p_store_id: string
  p_purchase_date: string | null
  p_note: string | null
  p_items: PurchaseItemInput[]
}

export type CreateTransferArgs = {
  p_store_id: string
  p_product_id: string
  p_quantity: number
  p_transfer_date: string | null
  p_note: string | null
  // Nơi nhận: quán (mặc định) hoặc công ty
  p_destination?: TransferDestination
}

export type TransferDestination = 'shop' | 'company'

// get_company_sets: một nhóm set đã phân phối cho công ty (chỉ số lượng)
export type CompanySetDbRow = {
  id: string
  distribution_date: string
  set_size: number
  set_count: number
  mix: Record<string, number>
  note: string | null
}

// Nguyên liệu (Bún đậu): tồn tính theo doanh thu × công thức
export type Ingredient = {
  id: string
  store_id: string
  name: string
  unit: string
  low_stock_threshold: number
  is_active: boolean
  created_at: string
}

export type Recipe = { id: string; product_id: string; ingredient_id: string; qty: number }

export type IngredientStockRow = {
  ingredient_id: string
  name: string
  unit: string
  low_stock_threshold: number
  received: number
  used: number
  on_hand: number
  used_recent: number
  last_receipt: string | null
}

// get_bundau_report: số liệu bán hàng theo ngày / kênh / món / giờ (tiền là số đồng)
export type BundauReport = {
  totals: { orders: number; gross: number; commission: number; discount: number; portions: number }
  days: { day: string; orders: number; gross: number; commission: number; discount: number }[]
  channels: { channel: string; orders: number; gross: number; commission: number }[]
  top: { name: string; qty: number; revenue: number }[]
  hours: { hour: number; orders: number; gross: number }[]
}

export type CreateSaleArgs = {
  p_store_id: string
  p_sale_date: string | null
  p_channel: SaleChannel
  p_note: string | null
  p_items: SaleItemInput[]
  p_commission_rate?: number | null
}

export type StockStatusRow = {
  product_id: string
  product_name: string
  qty_home: number
  qty_shop: number
  low_stock_threshold: number
  status: StockStatus
  // Hàng đã phân phối cho công ty, chưa bán (20261018163845_company_stock_destination.sql)
  qty_company: number
}

export type GetPnlArgs = {
  p_store_id: string
  p_period: PnlPeriod
  p_from: string
  p_to: string
}

export type PnlRow = {
  period_start: string
  gross_revenue: number
  commission: number
  net_revenue: number
  cogs: number
  gross_profit: number
  expenses: number
  net_profit: number
}

// Giá bán có hiệu lực vào một ngày — KHÔNG có giá vốn
export type StorePriceRow = {
  product_id: string
  sale_price: number
  app_price: number | null
  effective_from: string
}

export type SetProductPriceArgs = {
  p_product_id: string
  p_effective_from: string
  p_sale_price: number
  p_app_price: number | null
  p_unit_cost: number
  p_note: string | null
}

// Nhật ký ngày (chỉ admin) — supabase/migrations/20261018041617_daily_log_report.sql
export type DailyRangeArgs = { p_store_id: string; p_from: string; p_to: string }

// Một dòng (ngày, sản phẩm). shop_end / home_end = null với món không đếm tồn.
export type DailyProductLogRow = {
  day: string
  product_id: string
  product_name: string
  category: string | null
  tracks_stock: boolean
  qty_transferred: number
  qty_sold: number
  gross_revenue: number
  cogs: number
  shop_end: number | null
  home_end: number | null
  low_stock_threshold: number
}

// Một dòng mỗi ngày; các cột cum_* luỹ kế từ giao dịch đầu tiên của cửa hàng
export type DailySummaryRow = {
  day: string
  qty_sold: number
  gross_revenue: number
  commission: number
  net_revenue: number
  expenses: number
  cogs: number
  gross_profit: number
  net_profit: number
  purchase_cost: number
  cum_invested: number
  cum_net_revenue: number
  cum_cash_flow: number
  is_break_even: boolean
  price_notes: string | null
}

export type BreakEvenRow = {
  total_purchase_cost: number
  total_expenses: number
  total_invested: number
  cumulative_net_revenue: number
  shortfall: number
  pct_recovered: number | null
  break_even_date: string | null
  avg_daily_net_revenue: number
  remaining_stock_value: number
}

// admin_list_users (chỉ admin) — supabase/migrations/20261018020118_staff_management.sql
export type AdminUserRow = {
  id: string
  email: string
  full_name: string | null
  role: UserRole
  created_at: string
  last_sign_in_at: string | null
  store_ids: string[]
}

// ---------------------------------------------------------------------------
// Kiểu Database theo cấu trúc supabase-js
// Insert/Update = never với bảng client không được ghi trực tiếp.
// ---------------------------------------------------------------------------

type Rel = {
  foreignKeyName: string
  columns: string[]
  isOneToOne: boolean
  referencedRelation: string
  referencedColumns: string[]
}

type ReadOnlyTable<Row, Relationships extends Rel[]> = {
  Row: Row
  Insert: never
  Update: never
  Relationships: Relationships
}

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile
        Insert: never
        Update: ProfileUpdate
        Relationships: []
      }
      stores: {
        Row: Store
        Insert: StoreInsert
        Update: StoreUpdate
        Relationships: []
      }
      store_members: {
        Row: StoreMember
        Insert: StoreMemberInsert
        Update: StoreMemberUpdate
        Relationships: [
          { foreignKeyName: 'store_members_store_id_fkey'; columns: ['store_id']; isOneToOne: false; referencedRelation: 'stores'; referencedColumns: ['id'] },
          { foreignKeyName: 'store_members_user_id_fkey'; columns: ['user_id']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
        ]
      }
      products: {
        Row: Product
        Insert: ProductInsert
        Update: ProductUpdate
        Relationships: [
          { foreignKeyName: 'products_store_id_fkey'; columns: ['store_id']; isOneToOne: false; referencedRelation: 'stores'; referencedColumns: ['id'] },
        ]
      }
      // Ghi qua set_product_price
      product_prices: ReadOnlyTable<ProductPrice, [
        { foreignKeyName: 'product_prices_product_id_fkey'; columns: ['product_id']; isOneToOne: false; referencedRelation: 'products'; referencedColumns: ['id'] },
        { foreignKeyName: 'product_prices_created_by_fkey'; columns: ['created_by']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
      ]>
      purchases: ReadOnlyTable<Purchase, [
        { foreignKeyName: 'purchases_store_id_fkey'; columns: ['store_id']; isOneToOne: false; referencedRelation: 'stores'; referencedColumns: ['id'] },
        { foreignKeyName: 'purchases_created_by_fkey'; columns: ['created_by']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
      ]>
      stock_batches: ReadOnlyTable<StockBatch, [
        { foreignKeyName: 'stock_batches_purchase_id_fkey'; columns: ['purchase_id']; isOneToOne: false; referencedRelation: 'purchases'; referencedColumns: ['id'] },
        { foreignKeyName: 'stock_batches_store_id_fkey'; columns: ['store_id']; isOneToOne: false; referencedRelation: 'stores'; referencedColumns: ['id'] },
        { foreignKeyName: 'stock_batches_product_id_fkey'; columns: ['product_id']; isOneToOne: false; referencedRelation: 'products'; referencedColumns: ['id'] },
      ]>
      stock_transfers: ReadOnlyTable<StockTransfer, [
        { foreignKeyName: 'stock_transfers_store_id_fkey'; columns: ['store_id']; isOneToOne: false; referencedRelation: 'stores'; referencedColumns: ['id'] },
        { foreignKeyName: 'stock_transfers_product_id_fkey'; columns: ['product_id']; isOneToOne: false; referencedRelation: 'products'; referencedColumns: ['id'] },
        { foreignKeyName: 'stock_transfers_created_by_fkey'; columns: ['created_by']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
      ]>
      sales: ReadOnlyTable<Sale, [
        { foreignKeyName: 'sales_store_id_fkey'; columns: ['store_id']; isOneToOne: false; referencedRelation: 'stores'; referencedColumns: ['id'] },
        { foreignKeyName: 'sales_created_by_fkey'; columns: ['created_by']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
      ]>
      sale_items: ReadOnlyTable<SaleItem, [
        { foreignKeyName: 'sale_items_sale_id_fkey'; columns: ['sale_id']; isOneToOne: false; referencedRelation: 'sales'; referencedColumns: ['id'] },
        { foreignKeyName: 'sale_items_product_id_fkey'; columns: ['product_id']; isOneToOne: false; referencedRelation: 'products'; referencedColumns: ['id'] },
      ]>
      sale_item_cost_lines: ReadOnlyTable<SaleItemCostLine, [
        { foreignKeyName: 'sale_item_cost_lines_sale_item_id_fkey'; columns: ['sale_item_id']; isOneToOne: false; referencedRelation: 'sale_items'; referencedColumns: ['id'] },
        { foreignKeyName: 'sale_item_cost_lines_batch_id_fkey'; columns: ['batch_id']; isOneToOne: false; referencedRelation: 'stock_batches'; referencedColumns: ['id'] },
      ]>
      expenses: {
        Row: Expense
        Insert: ExpenseInsert
        Update: never
        Relationships: [
          { foreignKeyName: 'expenses_store_id_fkey'; columns: ['store_id']; isOneToOne: false; referencedRelation: 'stores'; referencedColumns: ['id'] },
          { foreignKeyName: 'expenses_created_by_fkey'; columns: ['created_by']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
        ]
      }
      ingredients: {
        Row: Ingredient
        Insert: { store_id: string; name: string; unit?: string; low_stock_threshold?: number; is_active?: boolean }
        Update: Partial<{ name: string; unit: string; low_stock_threshold: number; is_active: boolean }>
        Relationships: [
          { foreignKeyName: 'ingredients_store_id_fkey'; columns: ['store_id']; isOneToOne: false; referencedRelation: 'stores'; referencedColumns: ['id'] },
        ]
      }
      recipes: ReadOnlyTable<Recipe, [
        { foreignKeyName: 'recipes_product_id_fkey'; columns: ['product_id']; isOneToOne: false; referencedRelation: 'products'; referencedColumns: ['id'] },
        { foreignKeyName: 'recipes_ingredient_id_fkey'; columns: ['ingredient_id']; isOneToOne: false; referencedRelation: 'ingredients'; referencedColumns: ['id'] },
      ]>
    }
    Views: Record<never, never>
    Functions: {
      is_admin: { Args: Record<never, never>; Returns: boolean }
      is_store_member: { Args: { p_store_id: string }; Returns: boolean }
      create_purchase: { Args: CreatePurchaseArgs; Returns: string }
      create_transfer: { Args: CreateTransferArgs; Returns: string }
      create_sale: { Args: CreateSaleArgs; Returns: string }
      get_stock_status: { Args: { p_store_id: string }; Returns: StockStatusRow[] }
      get_pnl: { Args: GetPnlArgs; Returns: PnlRow[] }
      get_break_even: { Args: { p_store_id: string }; Returns: BreakEvenRow[] }
      admin_list_users: { Args: Record<never, never>; Returns: AdminUserRow[] }
      // supabase/migrations/20261018145530_admin_accounts.sql
      admin_set_role: { Args: { p_user_id: string; p_role: UserRole }; Returns: undefined }
      admin_set_full_name: { Args: { p_user_id: string; p_full_name: string }; Returns: undefined }
      // supabase/migrations/20261018165937_admin_edit_expense.sql
      update_expense: {
        Args: {
          p_expense_id: string
          p_expense_date: string
          p_category: string
          p_note: string | null
          p_quantity: number
          p_unit_price: number
          p_amount: number
        }
        Returns: undefined
      }
      delete_expense: { Args: { p_expense_id: string }; Returns: undefined }
      // supabase/migrations/20261019090000_purchase_expenses.sql
      record_purchase_expenses: {
        Args: { p_purchase_id: string; p_category: string; p_categories?: Record<string, string> }
        Returns: number
      }
      // supabase/migrations/20261018172554_company_sets.sql
      create_company_distribution: {
        Args: {
          p_store_id: string
          p_date: string | null
          p_note: string | null
          p_groups: { size: number; count: number; mix: Record<string, number> }[]
        }
        Returns: undefined
      }
      // supabase/migrations/20261023090000_bundau_ingredients.sql
      receive_ingredients: {
        Args: { p_store_id: string; p_date: string; p_items: { ingredient_id: string; quantity: number; amount: number | null; category: string }[] }
        Returns: number
      }
      set_recipe: { Args: { p_product_id: string; p_lines: { ingredient_id: string; qty: number }[] }; Returns: undefined }
      get_ingredient_stock: { Args: { p_store_id: string; p_recent_days?: number }; Returns: IngredientStockRow[] }
      get_bundau_report: { Args: { p_store_id: string; p_from: string; p_to: string }; Returns: BundauReport }
      // supabase/migrations/20261022100000_sale_discount.sql
      create_sale_discounted: {
        Args: {
          p_store_id: string
          p_sale_date: string | null
          p_channel: SaleChannel
          p_note: string | null
          p_items: CreateSaleArgs['p_items']
          p_discount_type: 'amount' | 'percent'
          p_discount_value: number
          p_commission_rate?: number | null
        }
        Returns: string
      }
      create_company_sale: {
        Args: {
          p_store_id: string
          p_sale_date: string | null
          p_note: string | null
          p_items: CreateSaleArgs['p_items']
          p_sets: { size: number; mix: Record<string, number>; count: number }[]
          p_discount_type?: 'amount' | 'percent'
          p_discount_value?: number
          p_list_total?: number
        }
        Returns: string
      }
      get_company_sets: { Args: { p_store_id: string; p_days?: number }; Returns: CompanySetDbRow[] }
      get_store_prices: { Args: { p_store_id: string; p_date: string | null }; Returns: StorePriceRow[] }
      set_product_price: { Args: SetProductPriceArgs; Returns: string }
      get_daily_product_log: { Args: DailyRangeArgs; Returns: DailyProductLogRow[] }
      get_daily_summary: { Args: DailyRangeArgs; Returns: DailySummaryRow[] }
    }
    Enums: Record<never, never>
    CompositeTypes: Record<never, never>
  }
}
