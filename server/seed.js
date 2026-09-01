import { hashPassword } from './lib/auth.js';
import { config } from './config.js';

const now = new Date().toISOString();

/**
 * Written only on first boot, per collection, when its file does not yet exist.
 * Adding a collection here therefore seeds it on an existing install without
 * touching data that is already on disk.
 */
export function seeds() {
  const pw = () => hashPassword(config().app.defaultPassword);
  return {
    EventMaster: [
      { eventId: 'E001', name: 'Silambam Kambu - Solo', category: 'Solo', description: 'Single-stick solo form', active: true, createdAt: now },
      { eventId: 'E002', name: 'Silambam Kambu - Pair', category: 'Pair', description: 'Two-person choreographed bout', active: true, createdAt: now },
      { eventId: 'E003', name: 'Maankombu', category: 'Weapon', description: 'Deer-horn weapon form', active: true, createdAt: now },
      { eventId: 'E004', name: 'Surul Vaal', category: 'Weapon', description: 'Flexible sword form', active: true, createdAt: now },
      { eventId: 'E005', name: 'Vaal Veechu', category: 'Weapon', description: 'Sword-swinging display', active: true, createdAt: now },
      { eventId: 'E006', name: 'Kuttu Varisai', category: 'Empty Hand', description: 'Empty-hand combat sequence', active: true, createdAt: now },
    ],
    LoginMaster: [
      { uid: 'SA001', password: pw(), role: 'SUPER_ADMIN', refId: 'SA001', name: 'Super Admin', active: true, createdAt: now },
      { uid: 'AD001', password: pw(), role: 'ADMIN', refId: 'AD001', name: 'Tournament Admin', active: true, createdAt: now },
    ],
    BoutMaster: [
      { boutId: 'B001', boutName: 'Bout 1 - Sub-Junior', status: 'open', judgeId: null, createdAt: now },
      { boutId: 'B002', boutName: 'Bout 2 - Junior', status: 'open', judgeId: null, createdAt: now },
      { boutId: 'B003', boutName: 'Bout 3 - Senior', status: 'open', judgeId: null, createdAt: now },
      { boutId: 'B004', boutName: 'Bout 4 - Open Weapons', status: 'open', judgeId: null, createdAt: now },
    ],
    // The spec caps scoring at five categories; the API enforces that on write.
    ScoreCategory: [
      { categoryId: 'SC1', categoryName: 'Position', order: 1, active: true },
      { categoryId: 'SC2', categoryName: 'Power', order: 2, active: true },
      { categoryId: 'SC3', categoryName: 'Speed', order: 3, active: true },
      { categoryId: 'SC4', categoryName: 'Stability', order: 4, active: true },
      { categoryId: 'SC5', categoryName: 'Style', order: 5, active: true },
    ],
    AgeCategory: [
      { ageCategoryId: 'AG001', name: 'Sub-Junior', minAge: 4, maxAge: 10, active: true, createdAt: now },
      { ageCategoryId: 'AG002', name: 'Junior', minAge: 11, maxAge: 15, active: true, createdAt: now },
      { ageCategoryId: 'AG003', name: 'Cadet', minAge: 16, maxAge: 18, active: true, createdAt: now },
      { ageCategoryId: 'AG004', name: 'Senior', minAge: 19, maxAge: 35, active: true, createdAt: now },
      { ageCategoryId: 'AG005', name: 'Veteran', minAge: 36, maxAge: 80, active: true, createdAt: now },
    ],
    PositionMaster: [
      { positionId: 'POS_DQ', positionName: 'Disqualified', order: 1, ranking: false },
      { positionId: 'POS_ABS', positionName: 'Absent', order: 2, ranking: false },
      { positionId: 'POS_1', positionName: '1', order: 3, ranking: true },
      { positionId: 'POS_2', positionName: '2', order: 4, ranking: true },
      { positionId: 'POS_3', positionName: '3', order: 5, ranking: true },
      { positionId: 'POS_4', positionName: '4', order: 6, ranking: false },
    ],
  };
}
