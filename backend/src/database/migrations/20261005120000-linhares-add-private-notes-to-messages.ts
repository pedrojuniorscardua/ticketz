import { QueryInterface, DataTypes } from "sequelize";

// Linhares: nota interna na conversa (so a equipe ve; nunca vai ao WhatsApp).
// isPrivate marca a nota e userId guarda o autor. Idempotente para nao
// quebrar num rebase em que o upstream crie uma coluna com o mesmo nome.
export default {
  up: async (queryInterface: QueryInterface) => {
    const table = await queryInterface.describeTable("Messages");

    if (!table.isPrivate) {
      await queryInterface.addColumn("Messages", "isPrivate", {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
      });
    }

    if (!table.userId) {
      await queryInterface.addColumn("Messages", "userId", {
        type: DataTypes.INTEGER,
        references: { model: "Users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
        allowNull: true
      });
    }
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("Messages", "userId");
    await queryInterface.removeColumn("Messages", "isPrivate");
  }
};
