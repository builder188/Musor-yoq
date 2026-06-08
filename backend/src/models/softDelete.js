// Soft-delete uchun umumiy maydonlar va yordamchi query helper.
// Har bir model shu maydonlarni qo'shadi: isDeleted, deletedAt.
export const softDeleteFields = {
  isDeleted: { type: Boolean, default: false, index: true },
  deletedAt: { type: Date, default: null },
};

// O'chirilmagan yozuvlar uchun standart filtr.
export const notDeleted = { isDeleted: { $ne: true } };
