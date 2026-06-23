import { Router } from 'express';

const router = Router();

router.get('/holiday/check/:date', (req, res) => {
  res.json({ isHoliday: false });
});

export default router;
