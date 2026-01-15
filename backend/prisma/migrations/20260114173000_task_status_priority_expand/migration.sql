-- Expand enums to match frontend (TaskStatus includes BLOCKED, TaskPriority includes HIGH).
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'BLOCKED';
ALTER TYPE "TaskPriority" ADD VALUE IF NOT EXISTS 'HIGH';

