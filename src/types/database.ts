// Kiểu dữ liệu viết tay, khớp với supabase/migrations/0001_init.sql.
// Có thể dùng với createClient<Database>(...).
// Cột numeric được PostgREST trả về dạng number; date dạng 'YYYY-MM-DD'; timestamptz dạng chuỗi ISO.

export type UserRole = 'admin' | 'staff'
export type SaleChannel = 'in_store' | 'shopeefood'
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
  sale_price: number
  app_price: number | null
  tracks_stock: boolean
  low_stock_threshold: number
  is_active: boolean
  created_at: string
}

export type ProductFixedCost = {
  product_id: string
  unit_cost: number
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
  created_at: string
}

export type StockTransfer = {
  id: string
  store_id: string
  product_id: string
  quantity: number
  transfer_date: string
  note: string | null
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
  amount: number
  note: string | null
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
  sale_price?: number
  app_price?: number | null
  tracks_stock?: boolean
  low_stock_threshold?: number
  is_active?: boolean
  created_at?: string
}
export type ProductUpdate = Partial<ProductInsert>

export type ProductFixedCostInsert = ProductFixedCost
export type ProductFixedCostUpdate = Partial<ProductFixedCost>

export type ExpenseInsert = {
  id?: string
  store_id: string
  expense_date?: string
  category: string
  amount: number
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

export type PurchaseItemInput = {
  product_id: string
  quantity: number
  unit_cost: number
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
      product_fixed_costs: {
        Row: ProductFixedCost
        Insert: ProductFixedCostInsert
        Update: ProductFixedCostUpdate
        Relationships: [
          { foreignKeyName: 'product_fixed_costs_product_id_fkey'; columns: ['product_id']; isOneToOne: true; referencedRelation: 'products'; referencedColumns: ['id'] },
        ]
      }
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
    }
    Enums: Record<never, never>
    CompositeTypes: Record<never, never>
  }
}
