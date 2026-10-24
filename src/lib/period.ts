import { presetRange, type Preset, type Range } from './bundauReport'

// Khoảng thời gian đang chọn của báo cáo: nút nhanh hoặc tự chọn từ ngày - đến ngày
export type PeriodState = { preset: Preset | 'custom'; range: Range }
export const initialPeriod = (preset: Preset, today: string): PeriodState => ({ preset, range: presetRange(preset, today) })
