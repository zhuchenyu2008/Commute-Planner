import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  await prisma.profile.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      city: "宁波",
      timezone: "Asia/Shanghai",
      defaultOriginName: "家",
      defaultOriginAddress: "金都嘉园52号",
      defaultOriginLngLat: "121.5230315924,29.8652491273"
    }
  });

  const existingPassword = await prisma.appSetting.findUnique({
    where: { key: "passwordHash" }
  });
  if (!existingPassword) {
    const raw = process.env.APP_INITIAL_PASSWORD || "change-me-now";
    const hash = process.env.APP_PASSWORD_HASH || (await bcrypt.hash(raw, 12));
    await prisma.appSetting.create({
      data: {
        key: "passwordHash",
        value: hash
      }
    });
  }

  const memories = [
    {
      id: "mem_company",
      type: "place",
      label: "公司",
      valueJson: JSON.stringify({
        name: "科技园中心",
        address: "宁波科技园中心",
        city: "宁波",
        lngLat: "121.624600,29.864300",
        estimateMinutes: 25
      })
    },
    {
      id: "mem_gym",
      type: "place",
      label: "健身房",
      valueJson: JSON.stringify({
        name: "健身房",
        address: "宁波健身房",
        city: "宁波",
        lngLat: "121.553500,29.858900",
        estimateMinutes: 15
      })
    }
  ];

  for (const memory of memories) {
    await prisma.memory.upsert({
      where: { id: memory.id },
      update: {},
      create: {
        ...memory,
        status: "confirmed"
      }
    });
  }
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
