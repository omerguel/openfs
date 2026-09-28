/* ------------------------------------------------------------------ */
/* System-assigned student numbers + start-of-training defaults.       */
/* Shared by the Schüler-Anmeldung form (client) and the Datenimport   */
/* (server) so both continue the same numbering range.                 */
/* ------------------------------------------------------------------ */

type Numbered = { customerNumber: string; contractNumber: string };

const CUSTOMER_FLOOR = 10058;
const CONTRACT_FLOOR = 1042;
const CONTRACT_PREFIX = "V-2026-";

const customerValue = (value: string) => Number(value) || 0;
const contractValue = (value: string) => Number(value.split("-").pop()) || 0;

/** Returns a generator that hands out consecutive free numbers, continuing
 *  after the highest customer/contract number among `existing`. */
export function studentNumberSequence(existing: Numbered[]) {
  let customer = existing.reduce(
    (max, s) => Math.max(max, customerValue(s.customerNumber)),
    CUSTOMER_FLOOR,
  );
  let contract = existing.reduce(
    (max, s) => Math.max(max, contractValue(s.contractNumber)),
    CONTRACT_FLOOR,
  );
  return {
    nextCustomerNumber: () => String(++customer),
    nextContractNumber: () => `${CONTRACT_PREFIX}${++contract}`,
  };
}

/** The next customer + contract number after `existing`. */
export function nextStudentNumbers(existing: Numbered[]): Numbered {
  const sequence = studentNumberSequence(existing);
  return {
    customerNumber: sequence.nextCustomerNumber(),
    contractNumber: sequence.nextContractNumber(),
  };
}
