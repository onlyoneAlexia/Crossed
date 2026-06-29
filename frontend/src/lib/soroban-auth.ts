import { Address, xdr } from "@stellar/stellar-sdk";

export function contractInvocation(
  contractId: string,
  functionName: string,
  args: xdr.ScVal[],
  subInvocations: xdr.SorobanAuthorizedInvocation[] = [],
) {
  return new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: Address.fromString(contractId).toScAddress(),
        functionName,
        args,
      }),
    ),
    subInvocations,
  });
}

export function sourceAccountAuthEntry(
  contractId: string,
  functionName: string,
  args: xdr.ScVal[],
  subInvocations: xdr.SorobanAuthorizedInvocation[] = [],
) {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: contractInvocation(contractId, functionName, args, subInvocations),
  });
}
