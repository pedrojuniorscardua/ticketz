import AppError from "../../errors/AppError";
import { getIO } from "../../libs/socket";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import Queue from "../../models/Queue";
import Ticket from "../../models/Ticket";
import User from "../../models/User";
import { CreatePrivateNoteService } from "../MessageServices/PrivateNoteService";

interface Request {
  ticketId: number;
  companyId: number;
  requesterId: number;
}

/**
 * Linhares: um atendente que nao consegue abrir conversa com um contato
 * (porque ele ja esta com outro atendente ou aguardando numa fila que nao e
 * a dele) pede a transferencia. O pedido vira nota interna no ticket e um
 * aviso para quem esta com o contato (ou para os admins, se ninguem esta).
 */
const RequestTicketTransferService = async ({
  ticketId,
  companyId,
  requesterId
}: Request): Promise<Message> => {
  const ticket = await Ticket.findOne({
    where: { id: ticketId, companyId },
    include: [
      { model: Contact, as: "contact", attributes: ["id", "name", "number"] },
      { model: User, as: "user", attributes: ["id", "name"] },
      { model: Queue, as: "queue", attributes: ["id", "name"] }
    ]
  });

  if (!ticket) {
    throw new AppError("ERR_NO_TICKET_FOUND", 404);
  }

  if (!["open", "pending"].includes(ticket.status)) {
    throw new AppError("ERR_TICKET_NOT_ACTIVE", 400);
  }

  if (ticket.userId === requesterId) {
    throw new AppError("ERR_TRANSFER_REQUEST_OWN_TICKET", 400);
  }

  const requester = await User.findByPk(requesterId, {
    attributes: ["id", "name"]
  });

  const note = await CreatePrivateNoteService({
    ticket,
    body: `📨 ${requester.name} pediu a transferência deste contato.`,
    userId: requesterId
  });

  const target = ticket.userId
    ? `user-${ticket.userId}`
    : `company-${companyId}-admin`;

  getIO()
    .to(target)
    .emit(`company-${companyId}-linhares-notice`, {
      action: "transfer-request",
      ticket: {
        id: ticket.id,
        uuid: ticket.uuid,
        status: ticket.status,
        userId: ticket.userId,
        queueName: ticket.queue?.name || null
      },
      contact: {
        id: ticket.contact.id,
        name: ticket.contact.name,
        number: ticket.contact.number
      },
      requester: { id: requester.id, name: requester.name }
    });

  return note;
};

export default RequestTicketTransferService;
