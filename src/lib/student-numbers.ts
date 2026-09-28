/* ------------------------------------------------------------------ */
/* System-assigned student numbers + start-of-training defaults.       */
/* Shared by the Schüler-Anmeldung form (client) and the Datenimport   */
/* (server) so both continue the same numbering range.                 */
/*                                                                     */
/* A new school starts low (Kunde 1001, Vertrag V-<Jahr>-0001); a      */
/* school with data — the demo included — continues after its highest  */
/* existing numbers.                                                   */
/* ------------------------------------------------------------------ */

type Numbered = { customerNumber: string; contractNumber: string };

const CUSTOMER_FLOOR = 1000;
const CONTRACT_FLOOR = 0;

const customerValue = (value: string) => Number(value) || 0;
const contractValue = (value: string) => Number(value.split("-").pop()) || 0;

/** Returns a generator that hands out consecutive free numbers, continuing
 *  after the highest customer/contract number among `existing`. */
export function studentNumberSequence(
  existing: Numbered[],
  year = new Date().getFullYear(),
) {
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
    nextContractNumber: () => `V-${year}-${String(++contract).padStart(4, "0")}`,
  };
}

/** The next customer + contract number after `existing`. */
export function nextStudentNumbers(
  existing: Numbered[],
  year = new Date().getFullYear(),
): Numbered {
  const sequence = studentNumberSequence(existing, year);
  return {
    customerNumber: sequence.nextCustomerNumber(),
    contractNumber: sequence.nextContractNumber(),
  };
}
